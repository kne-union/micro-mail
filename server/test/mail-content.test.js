const { expect } = require('chai');
const { MAX_BODY_LENGTH, getMailBody, formatAddressList, buildMailBrief } = require('../libs/mail-ai/content');

describe('mail-ai content', () => {
  describe('正文提取测试', () => {
    it('should prefer text body when text exists', () => {
      expect(getMailBody({ text: '  hello  ', html: '<p>ignored</p>' })).to.equal('hello');
    });

    it('should strip html, style and script when text is empty', () => {
      const html = '<style>p{}</style><script>alert(1)</script><p>Hello</p>\n<b>World</b>';
      expect(getMailBody({ text: '', html })).to.equal('Hello World');
    });

    it('should truncate body to MAX_BODY_LENGTH', () => {
      expect(getMailBody({ text: 'a'.repeat(MAX_BODY_LENGTH + 10) })).to.have.lengthOf(MAX_BODY_LENGTH);
    });

    it('should return empty string when mail has no body', () => {
      expect(getMailBody({})).to.equal('');
    });
  });

  describe('地址格式化测试', () => {
    it('should format string and object addresses', () => {
      const list = ['a@x.com', { name: 'Bob', address: 'b@x.com' }, { address: 'c@x.com' }, { name: 'NoAddress' }];
      expect(formatAddressList(list)).to.equal('a@x.com, Bob <b@x.com>, <c@x.com>, NoAddress');
    });

    it('should return empty string for non array or empty items', () => {
      expect(formatAddressList(null)).to.equal('');
      expect(formatAddressList([null, ''])).to.equal('');
    });
  });

  describe('邮件摘要测试', () => {
    it('should build brief with subject, from, to and body', () => {
      const brief = buildMailBrief({ subject: 'Hi', from: ['a@x.com'], to: ['b@x.com'], text: 'body' });
      expect(brief).to.equal(['Subject: Hi', 'From: a@x.com', 'To: b@x.com', '', 'body'].join('\n'));
    });

    it('should include cc line when cc exists', () => {
      const brief = buildMailBrief({ subject: 'Hi', from: ['a@x.com'], to: ['b@x.com'], cc: ['c@x.com'], text: 'body' });
      expect(brief.split('\n')).to.include('Cc: c@x.com');
    });

    it('should use placeholders when subject and body are empty', () => {
      const brief = buildMailBrief({ from: [], to: [] });
      expect(brief).to.include('Subject: (无主题)');
      expect(brief).to.include('(正文为空)');
    });
  });
});
