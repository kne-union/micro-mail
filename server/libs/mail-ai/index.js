const { shouldSkipAutoReply } = require('@kne/fastify-mail-gateway/libs/actions');
const { renderTemplate } = require('@kne/fastify-mail-gateway/libs/utils/template');
const { judgeByCriteria } = require('./filter');
const { generateAutoReply } = require('./auto-reply');
const { DEFAULT_LANGUAGE_THRESHOLD, detectLanguage, getMailLanguageContent, getMailPlainText, textToHtml } = require('./content');
const { TARGET_LANGUAGES, MAX_TEXT_LENGTH, MAX_HTML_LENGTH, getTargetLanguage, translateText, translateHtml, buildTranslatedMail, isTranslated } = require('./translate');
const { generateDigest } = require('./digest');

const createFormSchema = list => ({
  blocks: [{ id: 'params', kind: 'formInfo', column: 1, list }]
});

const LANGUAGE_OPTIONS = TARGET_LANGUAGES.map(({ value, label }) => ({ value, label }));

const targetLanguageField = {
  type: 'Select',
  name: 'targetLanguage',
  label: '目标语言',
  rule: 'REQ',
  props: { defaultValue: 'zh-CN', options: LANGUAGE_OPTIONS }
};

const sendImmediatelyField = {
  type: 'Switch',
  name: 'sendImmediately',
  label: '立即发送',
  description: '关闭后不发送，存入草稿箱，可修改后手动发送',
  props: { defaultValue: true }
};

// 旧规则没有该参数，按立即发送处理
const isSendImmediately = params => params.sendImmediately == null || params.sendImmediately === '' || params.sendImmediately === true || params.sendImmediately === 'true';

// 发信前翻译改存草稿时打上该标记，用户核对后手动发送不再重复翻译
const TRANSLATED_HEADER = 'X-Mail-Gateway-Translated';

// 占比最高的语言已是目标语言时不调用模型
const getSameLanguageSkip = (mail, target) => {
  const { language } = detectLanguage(getMailLanguageContent(mail));
  return language === target.value ? { skipped: true, reason: `邮件已是${target.label}` } : null;
};

/**
 * 参考 unfolds-platform 的 Azure OpenAI（@ai-sdk/azure + ai generateObject）用法，
 * 为邮件网关注册：AI 筛选条件 + AI 自动回复、翻译、汇总转发动作。
 */
module.exports = fastify => ({
  conditions: {
    aiFilter: {
      label: 'AI 筛选',
      description: '按填写的筛选内容调用大模型判断邮件是否命中（不限于垃圾邮件，可用于意图、主题、紧急程度等任意筛选）',
      directions: ['receive'],
      timeout: 60000,
      formSchema: createFormSchema([
        {
          type: 'TextArea',
          name: 'criteria',
          label: '筛选内容',
          rule: 'REQ',
          description: '用自然语言描述何时命中，例如「客户咨询发票/开票」「招聘相关简历投递」「垃圾广告或钓鱼邮件」',
          props: { rows: 4, placeholder: '请描述筛选条件…' }
        },
        {
          type: 'InputNumber',
          name: 'minConfidence',
          label: '最低置信度',
          description: '仅当模型置信度不低于该值时才视为命中',
          props: { defaultValue: 0.6, min: 0, max: 1, step: 0.1 }
        }
      ]),
      evaluate: async ({ mail, params }) => {
        const result = await judgeByCriteria(fastify, { mail, params });
        return { matched: result.matched, reason: `${result.reason}（置信度 ${result.confidence.toFixed(2)}）` };
      }
    },
    languageDetect: {
      label: '邮件语言',
      description: '统计主题与纯文本正文（不统计 HTML）中所选语言的占比，达到阈值即命中；汉字、假名、韩文按字计，其他文字按词计，英法德西等拉丁字母语言按常见词区分',
      directions: ['receive', 'beforeSend', 'send'],
      formSchema: createFormSchema([
        {
          type: 'Select',
          name: 'language',
          label: '语言',
          rule: 'REQ',
          props: { defaultValue: 'zh-CN', options: LANGUAGE_OPTIONS }
        },
        {
          type: 'InputNumber',
          name: 'threshold',
          label: '占比阈值',
          description: '所选语言占比不低于该值即命中',
          props: { defaultValue: DEFAULT_LANGUAGE_THRESHOLD, min: 0.05, max: 1, step: 0.05 }
        }
      ]),
      evaluate: async ({ mail, params }) => {
        const target = getTargetLanguage(params.language || 'zh-CN');
        const threshold = params.threshold == null || params.threshold === '' ? DEFAULT_LANGUAGE_THRESHOLD : Number(params.threshold);
        const { ratios, language } = detectLanguage(getMailLanguageContent(mail));
        if (!language) {
          return { matched: false, reason: '邮件中没有可统计的文字' };
        }
        const ratio = ratios[target.value] || 0;
        return {
          matched: ratio >= threshold,
          reason: `${target.label}占比 ${(ratio * 100).toFixed(1)}%（阈值 ${(threshold * 100).toFixed(0)}%）`
        };
      }
    }
  },
  actions: {
    aiAutoReply: {
      label: 'AI 自动回复',
      description: '用大模型根据来信生成回复内容，并通过当前邮箱发送（或存入草稿箱待修改）；可选参考邮件模版；自动跳过自动生成邮件、邮件列表和 no-reply 发件人',
      directions: ['receive'],
      formSchema: createFormSchema([
        {
          type: 'MailTemplateSelect',
          name: 'templateId',
          label: '邮件模版',
          description: '可选；选择后 AI 会参考模版结构与表述，并结合来信做个性化改写'
        },
        {
          type: 'TextArea',
          name: 'instruction',
          label: '回复指示（可选）',
          description: '例如：告知 1 个工作日内人工跟进；签名使用某某团队；不要承诺具体时效',
          props: { rows: 4 }
        },
        {
          type: 'Select',
          name: 'tone',
          label: '语气',
          props: {
            defaultValue: 'professional',
            options: [
              { label: '专业礼貌', value: 'professional' },
              { label: '友好热情', value: 'friendly' },
              { label: '简洁克制', value: 'concise' }
            ]
          }
        },
        {
          type: 'InputNumber',
          name: 'intervalHours',
          label: '同一发件人最短回复间隔（小时）',
          props: { defaultValue: 24, min: 0 }
        },
        sendImmediatelyField
      ]),
      handler: async ({ mail, account, params, services, models, fastify: app }) => {
        const skipReason = shouldSkipAutoReply({ mail, account });
        if (skipReason) {
          return { skipped: true, reason: skipReason };
        }
        const sender = (mail.from || [])[0];
        if (!sender?.address) {
          return { skipped: true, reason: '发件人为空' };
        }
        const intervalHours = params.intervalHours == null || params.intervalHours === '' ? 24 : Number(params.intervalHours);
        if (intervalHours > 0) {
          const { Op } = app.sequelize.Sequelize;
          const recent = await models.mail.findAll({
            where: {
              accountId: mail.accountId,
              folder: 'sent',
              date: { [Op.gte]: new Date(Date.now() - intervalHours * 3600 * 1000) }
            },
            attributes: ['to', 'headers']
          });
          const replied = recent.some(item => (item.headers || {})['auto-submitted'] === 'auto-replied' && (item.to || []).some(to => String(to.address).toLowerCase() === sender.address.toLowerCase()));
          if (replied) {
            return { skipped: true, reason: `${intervalHours} 小时内已自动回复过该发件人` };
          }
        }
        const sendImmediately = isSendImmediately(params);
        if (!sendImmediately && mail.messageId) {
          const existing = await models.mail.findOne({ where: { accountId: mail.accountId, folder: 'draft', inReplyTo: mail.messageId }, attributes: ['id'] });
          if (existing) {
            return { skipped: true, reason: '草稿箱中已有该邮件的回复草稿', draftId: existing.id };
          }
        }

        let template = null;
        const templateId = params.templateId && typeof params.templateId === 'object' ? params.templateId.id || params.templateId.value : params.templateId;
        if (templateId) {
          const target = await services.template.detail({ id: templateId, userId: account && account.userId });
          if (target.status !== 'enabled') {
            throw new Error(`邮件模版「${target.name}」已停用`);
          }
          const data = { mail, account };
          template = {
            id: target.id,
            subject: renderTemplate(target.subject || '', data),
            html: renderTemplate(target.html || '', data, { html: true })
          };
        }

        const generated = await generateAutoReply(fastify, { mail, account, params, template });
        if (!sendImmediately) {
          const draft = await services.draft.save({
            userId: account && account.userId,
            accountId: mail.accountId,
            to: [sender],
            subject: generated.subject,
            html: generated.html,
            inReplyTo: mail.messageId,
            references: mail.references
          });
          return {
            draftId: draft.id,
            to: sender.address,
            subject: generated.subject,
            templateId: generated.templateId || templateId || null
          };
        }
        const reply = await services.mail.send({
          userId: account && account.userId,
          accountId: mail.accountId,
          to: [sender],
          subject: generated.subject,
          html: generated.html,
          inReplyTo: mail.messageId,
          references: mail.references,
          headers: { 'Auto-Submitted': 'auto-replied', 'X-Auto-Response-Suppress': 'All' },
          skipRules: true
        });
        return {
          replyMailId: reply.id,
          to: sender.address,
          subject: generated.subject,
          templateId: generated.templateId || templateId || null
        };
      }
    },
    aiTranslateOnReceive: {
      label: 'AI 翻译（收信后）',
      description: '用大模型把来信翻译为目标语言，译文追加在原邮件前面，分别标注「翻译：」「原文：」；邮件已是目标语言（仅能判断中英文）或已翻译过时跳过',
      directions: ['receive'],
      formSchema: createFormSchema([targetLanguageField]),
      handler: async ({ mail, params, models }) => {
        const target = getTargetLanguage(params.targetLanguage);
        if (isTranslated(mail)) {
          return { skipped: true, reason: '邮件已翻译过' };
        }
        const skip = getSameLanguageSkip(mail, target);
        if (skip) {
          return skip;
        }
        const text = getMailPlainText(mail);
        if (!text && !mail.subject) {
          return { skipped: true, reason: '邮件内容为空' };
        }
        const truncated = text.length > MAX_TEXT_LENGTH;
        const translated = await translateText(fastify, { subject: mail.subject, text: text.slice(0, MAX_TEXT_LENGTH), target });
        const { html, text: nextText } = buildTranslatedMail({ mail, target, translated, truncated });
        await models.mail.update({ html, text: nextText }, { where: { id: mail.id } });
        return { targetLanguage: target.value, subject: translated.subject, truncated };
      }
    },
    aiTranslateBeforeSend: {
      label: 'AI 翻译（发信前）',
      description: '发送前用大模型把主题和正文直接翻译为目标语言后再发出（或存入草稿箱待核对），尽量保留正文排版；邮件已是目标语言（仅能判断中英文）或已翻译核对过时跳过，翻译失败时邮件不会发出',
      directions: ['beforeSend'],
      formSchema: createFormSchema([targetLanguageField, sendImmediatelyField]),
      handler: async ({ mail, params }) => {
        if ((mail.headers || {})[TRANSLATED_HEADER.toLowerCase()]) {
          return { skipped: true, reason: '邮件已翻译并核对过' };
        }
        const target = getTargetLanguage(params.targetLanguage);
        const skip = getSameLanguageSkip(mail, target);
        if (skip) {
          return skip;
        }
        const translateMail = async () => {
          const html = String(mail.html || '').trim();
          if (html && html.length <= MAX_HTML_LENGTH) {
            const translated = await translateHtml(fastify, { subject: mail.subject, html, target });
            if (!translated.html) {
              throw new Error('AI 翻译结果为空');
            }
            return { subject: translated.subject || mail.subject, html: translated.html };
          }
          const text = getMailPlainText(mail);
          if (text.length > MAX_TEXT_LENGTH) {
            throw new Error(`邮件正文超过 ${MAX_TEXT_LENGTH} 字，无法翻译`);
          }
          const translated = await translateText(fastify, { subject: mail.subject, text, target });
          if (!translated.body && text) {
            throw new Error('AI 翻译结果为空');
          }
          return { subject: translated.subject || mail.subject, html: textToHtml(translated.body), text: translated.body };
        };
        const translatedMail = await translateMail();
        if (isSendImmediately(params)) {
          return { targetLanguage: target.value, mail: translatedMail };
        }
        return {
          targetLanguage: target.value,
          draft: true,
          mail: Object.assign(translatedMail, { headers: { [TRANSLATED_HEADER]: target.value } })
        };
      }
    },
    aiDigestForward: {
      label: 'AI 汇总转发',
      description: '未读邮件规则中用大模型把本次统计到的未读邮件汇总为概览和逐封要点（标注需尽快处理的邮件），用当前邮箱发给指定地址；邮件较多时只汇总最近 50 封',
      directions: ['schedule'],
      formSchema: createFormSchema([
        { type: 'MailContactSelect', name: 'to', label: '转发给', rule: 'REQ' },
        Object.assign({}, targetLanguageField, { label: '汇总语言' }),
        {
          type: 'TextArea',
          name: 'instruction',
          label: '汇总要求（可选）',
          description: '例如：重点标出客户投诉和付款相关邮件；每封要点不超过 30 字',
          props: { rows: 4 }
        }
      ]),
      handler: async ({ mails, account, params, services }) => {
        if (!mails || mails.length === 0) {
          return { skipped: true, reason: '没有需要汇总的邮件' };
        }
        const target = getTargetLanguage(params.targetLanguage || 'zh-CN');
        const digest = await generateDigest(fastify, { mails, account, params, target });
        const sent = await services.mail.send({
          userId: account && account.userId,
          accountId: account.id,
          to: params.to,
          subject: digest.subject || `未读邮件汇总（${mails.length} 封）`,
          html: digest.html,
          headers: { 'Auto-Submitted': 'auto-generated' },
          skipRules: true
        });
        return { digestMailId: sent.id, count: mails.length, summarized: digest.count, omitted: digest.omitted };
      }
    }
  }
});
