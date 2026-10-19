const { shouldSkipAutoReply } = require('@kne/fastify-mail-gateway/libs/actions');
const { renderTemplate } = require('@kne/fastify-mail-gateway/libs/utils/template');
const { judgeByCriteria } = require('./filter');
const { generateAutoReply } = require('./auto-reply');

const createFormSchema = list => ({
  blocks: [{ id: 'params', kind: 'formInfo', column: 1, list }]
});

/**
 * 参考 unfolds-platform 的 Azure OpenAI（@ai-sdk/azure + ai generateObject）用法，
 * 为邮件网关注册：AI 筛选条件 + AI 自动回复动作。
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
    }
  },
  actions: {
    aiAutoReply: {
      label: 'AI 自动回复',
      description: '用大模型根据来信生成回复内容，并通过当前邮箱发送；可选参考邮件模版；自动跳过自动生成邮件、邮件列表和 no-reply 发件人',
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
        }
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
    }
  }
});
