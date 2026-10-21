const { expect } = require('chai');
const { detectLanguage, getMailLanguageContent, getMailPlainText, textToHtml } = require('../libs/mail-ai/content');
const { getTargetLanguage, sanitizeHtml, buildTranslatedMail, isTranslated } = require('../libs/mail-ai/translate');
const createMailAi = require('../libs/mail-ai');

describe('mail-ai translate', () => {
  describe('语言判断测试', () => {
    it('should count cjk by character and other scripts by word', () => {
      const { ratios, language } = detectLanguage('请查看附件中的 invoice 和 PDF');
      expect(language).to.equal('zh-CN');
      expect(ratios['zh-CN']).to.equal(0.8);
      expect(ratios.en).to.equal(0.2);
      expect(detectLanguage('123 !!').language).to.equal(null);
    });

    it('should detect english mail with a chinese name', () => {
      expect(detectLanguage('Hi team, please review the quarterly report before Friday. Thanks, 张三').language).to.equal('en');
    });

    it('should detect every target language', () => {
      expect(detectLanguage('良い習慣は、成功と幸せな人生の土台です。').language).to.equal('ja');
      expect(detectLanguage('좋은 습관은 성공의 기초입니다').language).to.equal('ko');
      expect(detectLanguage('Хорошие привычки — основа успеха').language).to.equal('ru');
      expect(detectLanguage('Les bonnes habitudes sont la base du succès et de la vie').language).to.equal('fr');
      expect(detectLanguage('Gute Gewohnheiten sind die Grundlage für Erfolg und ein glückliches Leben').language).to.equal('de');
      expect(detectLanguage('Los buenos hábitos son la base del éxito y de una vida feliz').language).to.equal('es');
      expect(detectLanguage('Good habits are the foundation of success and a happy life').language).to.equal('en');
    });

    it('should ignore links and email addresses', () => {
      expect(detectLanguage('请查看 https://example.com/report/view?id=1 或联系 john.doe@example.com').ratios['zh-CN']).to.equal(1);
    });

    it('should only use subject and text, not html', () => {
      expect(getMailLanguageContent({ subject: '主题', text: '正文', html: '<p>English html body</p>' })).to.equal('主题\n正文');
    });
  });

  describe('正文提取测试', () => {
    it('should keep paragraphs when converting html to text', () => {
      expect(getMailPlainText({ html: '<style>p{}</style><p>Hello&nbsp;world</p><p>Line1<br>Line2</p>' })).to.equal('Hello world\nLine1\nLine2');
    });

    it('should escape html when converting text to paragraphs', () => {
      expect(textToHtml('a <b>\nnext\n\nsecond')).to.equal('<p>a &lt;b&gt;<br>next</p><p>second</p>');
    });
  });

  describe('收信译文拼装测试', () => {
    const target = getTargetLanguage('zh-CN');

    it('should put translation before the original inside body', () => {
      const mail = { subject: 'Hello', html: '<html><body><p>Hi</p></body></html>', text: 'Hi' };
      const { html, text } = buildTranslatedMail({ mail, target, translated: { subject: '你好', body: '嗨 <script>' }, truncated: false });
      expect(html).to.match(/^<html><body><div data-mail-translation="zh-CN"><p><strong>翻译：<\/strong><\/p><p>主题：你好<\/p><p>嗨 &lt;script&gt;<\/p><\/div><hr><p><strong>原文：<\/strong><\/p><p>Hi<\/p><\/body><\/html>$/);
      expect(text).to.equal(['翻译：', '主题：你好', '嗨 <script>', '', '原文：', 'Hi'].join('\n'));
      expect(isTranslated({ html })).to.equal(true);
    });

    it('should build html from text when original html is empty and note truncation', () => {
      const { html } = buildTranslatedMail({ mail: { text: 'Hi' }, target, translated: { subject: '', body: '嗨' }, truncated: true });
      expect(html).to.contain('仅翻译前');
      expect(html.endsWith('<p><strong>原文：</strong></p><p>Hi</p>')).to.equal(true);
    });

    it('should reject unknown target language', () => {
      expect(() => getTargetLanguage('xx')).to.throw('请选择目标语言');
    });
  });

  describe('HTML 清洗测试', () => {
    it('should remove scripts, event handlers and javascript links', () => {
      const html = sanitizeHtml('```html\n<p onclick="x()">A</p><script>alert(1)</script><a href="javascript:alert(1)">B</a><a href="https://x.com">C</a>\n```');
      expect(html).to.equal('<p>A</p><a>B</a><a href="https://x.com">C</a>');
    });
  });

  describe('规则条件与动作测试', () => {
    const mailAi = createMailAi({ config: {} });

    it('should match language condition with reason', async () => {
      const result = await mailAi.conditions.languageDetect.evaluate({ mail: { subject: '发票', text: '请开具九月发票' }, params: { language: 'zh-CN' } });
      expect(result.matched).to.equal(true);
      expect(result.reason).to.equal('简体中文占比 100.0%（阈值 30%）');
      const en = await mailAi.conditions.languageDetect.evaluate({ mail: { subject: '发票', text: '请开具九月发票' }, params: { language: 'en' } });
      expect(en.matched).to.equal(false);
    });

    it('should match when target language ratio reaches threshold', async () => {
      const mail = { text: '请查看附件中的 invoice 和 PDF' };
      expect((await mailAi.conditions.languageDetect.evaluate({ mail, params: { language: 'en', threshold: 0.2 } })).matched).to.equal(true);
      expect((await mailAi.conditions.languageDetect.evaluate({ mail, params: { language: 'en', threshold: 0.3 } })).matched).to.equal(false);
    });

    it('should not match when mail has no countable text', async () => {
      const result = await mailAi.conditions.languageDetect.evaluate({ mail: { text: '123' }, params: { language: 'en' } });
      expect(result.matched).to.equal(false);
    });

    it('should support all trigger directions for the language condition', () => {
      expect(mailAi.conditions.languageDetect.directions).to.deep.equal(['receive', 'beforeSend', 'send']);
    });

    it('should skip translation when mail is already in target language', async () => {
      const mail = { id: '1', subject: '你好', text: '这是一封中文邮件' };
      expect(await mailAi.actions.aiTranslateOnReceive.handler({ mail, params: { targetLanguage: 'zh-CN' } })).to.deep.equal({ skipped: true, reason: '邮件已是简体中文' });
      expect(await mailAi.actions.aiTranslateBeforeSend.handler({ mail, params: { targetLanguage: 'zh-CN' } })).to.deep.equal({ skipped: true, reason: '邮件已是简体中文' });
      const ja = { id: '2', subject: '良い習慣の力', text: '良い習慣は成功の土台です' };
      expect(await mailAi.actions.aiTranslateBeforeSend.handler({ mail: ja, params: { targetLanguage: 'ja' } })).to.deep.equal({ skipped: true, reason: '邮件已是日语' });
    });

    it('should skip receive translation when mail was translated', async () => {
      const result = await mailAi.actions.aiTranslateOnReceive.handler({ mail: { id: '1', html: '<div data-mail-translation="en"></div>' }, params: { targetLanguage: 'en' } });
      expect(result).to.deep.equal({ skipped: true, reason: '邮件已翻译过' });
    });

    it('should fail when azure openai is not configured', async () => {
      let error;
      try {
        await mailAi.actions.aiTranslateBeforeSend.handler({ mail: { subject: 'Hello', html: '<p>Hello world</p>' }, params: { targetLanguage: 'zh-CN' } });
      } catch (e) {
        error = e;
      }
      expect(error && error.message).to.contain('未配置 Azure OpenAI');
    });

    it('should declare trigger directions for translate actions', () => {
      expect(mailAi.actions.aiTranslateOnReceive.directions).to.deep.equal(['receive']);
      expect(mailAi.actions.aiTranslateBeforeSend.directions).to.deep.equal(['beforeSend']);
    });
  });
});
