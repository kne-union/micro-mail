const path = require('node:path');
const { expect } = require('chai');

const AI_MODULE = require.resolve('ai');
const MAIL_AI_DIR = path.resolve(__dirname, '../libs/mail-ai');

const azureConfig = {
  AZURE_OPENAI_API_KEY: 'test-key',
  AZURE_OPENAI_CHAT_DEPLOYMENT: 'gpt-test',
  AZURE_OPENAI_RESOURCE_NAME: 'test-resource'
};

// 替换 ai.generateObject 后重新加载 mail-ai，避免调用真实模型
const loadMailAi = generateObject => {
  const original = require.cache[AI_MODULE];
  require.cache[AI_MODULE] = { id: AI_MODULE, filename: AI_MODULE, loaded: true, exports: { generateObject } };
  Object.keys(require.cache)
    .filter(key => key.startsWith(MAIL_AI_DIR))
    .forEach(key => delete require.cache[key]);
  try {
    return {
      createMailAi: require('../libs/mail-ai'),
      digest: require('../libs/mail-ai/digest')
    };
  } finally {
    if (original) {
      require.cache[AI_MODULE] = original;
    } else {
      delete require.cache[AI_MODULE];
    }
    Object.keys(require.cache)
      .filter(key => key.startsWith(MAIL_AI_DIR))
      .forEach(key => delete require.cache[key]);
  }
};

const createServices = () => {
  const calls = { send: [], draft: [] };
  return {
    calls,
    services: {
      mail: {
        send: async payload => {
          calls.send.push(payload);
          return { id: 'sent-1', folder: 'sent' };
        }
      },
      draft: {
        save: async payload => {
          calls.draft.push(payload);
          return { id: 'draft-1', folder: 'draft' };
        }
      }
    }
  };
};

const createMails = count =>
  Array.from({ length: count }, (_, index) => ({
    id: `m${index + 1}`,
    subject: `主题 ${index + 1}`,
    from: [{ name: '客户', address: `c${index + 1}@x.com` }],
    date: new Date(Date.UTC(2026, 9, 22, 1, index)),
    text: `第 ${index + 1} 封邮件正文`
  }));

describe('mail-ai digest', () => {
  describe('AI 汇总转发', () => {
    it('should only summarize the latest mails and truncate long body', () => {
      const { digest } = loadMailAi(async () => ({}));
      const mails = createMails(digest.MAX_DIGEST_MAILS + 3);
      const { list, omitted } = digest.pickDigestMails(mails);
      expect(list).to.have.length(digest.MAX_DIGEST_MAILS);
      expect(list[0].id).to.equal('m4');
      expect(omitted).to.equal(3);

      const prompt = digest.buildDigestPrompt({
        mails: [{ subject: '长邮件', text: 'a'.repeat(digest.MAX_MAIL_BRIEF_LENGTH * 2) }],
        omitted,
        accountName: '客服',
        instruction: '标出付款邮件',
        target: { name: '简体中文' }
      });
      expect(prompt).to.contain('另有更早的 3 封未列出');
      expect(prompt).to.contain('（已截断）');
      expect(prompt).to.contain('标出付款邮件');
      expect(prompt).to.contain('使用简体中文输出');
    });

    it('should send ai digest through current account without triggering rules', async () => {
      let prompt;
      const { createMailAi } = loadMailAi(async options => {
        prompt = options.prompt;
        return { object: { subject: '未读汇总', html: '<h3>概览</h3><script>x()</script><p>共 2 封</p>' } };
      });
      const mailAi = createMailAi({ config: azureConfig });
      const { services, calls } = createServices();
      const account = { id: 'a1', userId: 'u1', name: '客服' };
      const result = await mailAi.actions.aiDigestForward.handler({
        mails: createMails(2),
        account,
        params: { to: [{ address: 'boss@x.com' }], targetLanguage: 'zh-CN' },
        services
      });
      expect(prompt).to.contain('主题 1').and.contain('主题 2');
      expect(result).to.deep.equal({ digestMailId: 'sent-1', count: 2, summarized: 2, omitted: 0 });
      expect(calls.send).to.have.length(1);
      expect(calls.send[0]).to.deep.include({
        userId: 'u1',
        accountId: 'a1',
        subject: '未读汇总',
        html: '<h3>概览</h3><p>共 2 封</p>',
        skipRules: true
      });
      expect(calls.send[0].to).to.deep.equal([{ address: 'boss@x.com' }]);
      expect(calls.send[0].headers).to.deep.equal({ 'Auto-Submitted': 'auto-generated' });
    });

    it('should skip when there is no mail and declare schedule direction', async () => {
      const { createMailAi } = loadMailAi(async () => ({}));
      const mailAi = createMailAi({ config: azureConfig });
      expect(mailAi.actions.aiDigestForward.directions).to.deep.equal(['schedule']);
      const result = await mailAi.actions.aiDigestForward.handler({ mails: [], account: { id: 'a1' }, params: {}, services: {} });
      expect(result).to.deep.equal({ skipped: true, reason: '没有需要汇总的邮件' });
    });
  });

  describe('立即发送开关', () => {
    const generateReplyOrTranslation = async options => {
      if (options.prompt.includes('翻译') || options.prompt.toLowerCase().includes('translat')) {
        return { object: { subject: 'Hello', segments: ['Hello world'], body: 'Hello world' } };
      }
      return { object: { subject: 'Re: 咨询', html: '<p>已收到</p>' } };
    };

    const incoming = { id: 'in-1', accountId: 'a1', messageId: '<in-1@x.com>', references: [], subject: '咨询', text: '请问价格', from: [{ address: 'c@x.com' }], headers: {} };
    const account = { id: 'a1', userId: 'u1', address: 'me@x.com' };

    it('should declare send switch default on', () => {
      const { createMailAi } = loadMailAi(generateReplyOrTranslation);
      const mailAi = createMailAi({ config: azureConfig });
      ['aiAutoReply', 'aiTranslateBeforeSend'].forEach(name => {
        const field = mailAi.actions[name].formSchema.blocks[0].list.find(item => item.name === 'sendImmediately');
        expect(field.type).to.equal('Switch');
        expect(field.props.defaultValue).to.equal(true);
      });
    });

    it('should save auto reply into draft when send switch is off', async () => {
      const { createMailAi } = loadMailAi(generateReplyOrTranslation);
      const mailAi = createMailAi({ config: azureConfig });
      const { services, calls } = createServices();
      const models = { mail: { findOne: async () => null } };
      const result = await mailAi.actions.aiAutoReply.handler({ mail: incoming, account, params: { intervalHours: 0, sendImmediately: false }, services, models });
      expect(calls.send).to.have.length(0);
      expect(calls.draft).to.have.length(1);
      expect(calls.draft[0]).to.deep.include({ userId: 'u1', accountId: 'a1', subject: 'Re: 咨询', inReplyTo: '<in-1@x.com>' });
      expect(calls.draft[0].to).to.deep.equal([{ address: 'c@x.com' }]);
      expect(result).to.deep.include({ draftId: 'draft-1', to: 'c@x.com', subject: 'Re: 咨询' });
    });

    it('should not create duplicated reply draft', async () => {
      const { createMailAi } = loadMailAi(generateReplyOrTranslation);
      const mailAi = createMailAi({ config: azureConfig });
      const { services, calls } = createServices();
      const models = { mail: { findOne: async () => ({ id: 'draft-old' }) } };
      const result = await mailAi.actions.aiAutoReply.handler({ mail: incoming, account, params: { intervalHours: 0, sendImmediately: false }, services, models });
      expect(result).to.deep.equal({ skipped: true, reason: '草稿箱中已有该邮件的回复草稿', draftId: 'draft-old' });
      expect(calls.draft).to.have.length(0);
    });

    it('should send auto reply immediately when switch is missing', async () => {
      const { createMailAi } = loadMailAi(generateReplyOrTranslation);
      const mailAi = createMailAi({ config: azureConfig });
      const { services, calls } = createServices();
      const result = await mailAi.actions.aiAutoReply.handler({ mail: incoming, account, params: { intervalHours: 0 }, services, models: {} });
      expect(calls.draft).to.have.length(0);
      expect(calls.send).to.have.length(1);
      expect(calls.send[0].skipRules).to.equal(true);
      expect(result.replyMailId).to.equal('sent-1');
    });

    it('should return draft output with translated marker when switch is off', async () => {
      const { createMailAi } = loadMailAi(generateReplyOrTranslation);
      const mailAi = createMailAi({ config: azureConfig });
      const mail = { subject: '你好', html: '<p>你好，世界</p>', text: '你好，世界', headers: {} };
      const result = await mailAi.actions.aiTranslateBeforeSend.handler({ mail, params: { targetLanguage: 'en', sendImmediately: false } });
      expect(result.draft).to.equal(true);
      expect(result.mail.html).to.equal('<p>Hello world</p>');
      expect(result.mail.headers).to.deep.equal({ 'X-Mail-Gateway-Translated': 'en' });

      const immediate = await mailAi.actions.aiTranslateBeforeSend.handler({ mail, params: { targetLanguage: 'en' } });
      expect(immediate.draft).to.equal(undefined);
      expect(immediate.mail.headers).to.equal(undefined);
    });

    it('should skip translation when draft was already translated', async () => {
      const { createMailAi } = loadMailAi(async () => {
        throw new Error('should not call model');
      });
      const mailAi = createMailAi({ config: azureConfig });
      const mail = { subject: '你好', text: '你好，世界', headers: { 'x-mail-gateway-translated': 'en' } };
      const result = await mailAi.actions.aiTranslateBeforeSend.handler({ mail, params: { targetLanguage: 'en' } });
      expect(result).to.deep.equal({ skipped: true, reason: '邮件已翻译并核对过' });
    });
  });
});
