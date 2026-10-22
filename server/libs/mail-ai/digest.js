const { z } = require('zod');
const { generateObject } = require('ai');
const { createAzureClients, assertAzureChatReady } = require('../utils/azure-openai');
const { buildMailBrief } = require('./content');
const { sanitizeHtml } = require('./translate');

// 控制模型输入长度：每封邮件截断，超过上限只汇总最近的若干封
const MAX_DIGEST_MAILS = 50;
const MAX_MAIL_BRIEF_LENGTH = 1500;

const digestSchema = z.object({
  subject: z.string().max(200).describe('digest mail subject'),
  html: z.string().describe('digest body as simple HTML fragment using h3/p/br/ul/ol/li/strong only, no full html/body')
});

const pickDigestMails = mails => {
  const list = mails || [];
  return { list: list.slice(-MAX_DIGEST_MAILS), omitted: Math.max(list.length - MAX_DIGEST_MAILS, 0) };
};

const formatDate = date => (date ? new Date(date).toISOString().replace('T', ' ').slice(0, 16) : '');

const buildDigestMailsText = mails =>
  mails
    .map((mail, index) => {
      const brief = buildMailBrief(mail);
      const content = brief.length > MAX_MAIL_BRIEF_LENGTH ? `${brief.slice(0, MAX_MAIL_BRIEF_LENGTH)}…（已截断）` : brief;
      return `### 第 ${index + 1} 封（${formatDate(mail.date)}）\n${content}`;
    })
    .join('\n\n');

const buildDigestPrompt = ({ mails, omitted = 0, accountName, instruction, target }) => `你是「${accountName}」邮箱的邮件助理。下面是该邮箱一段时间内未读的 ${mails.length} 封邮件${
  omitted > 0 ? `（另有更早的 ${omitted} 封未列出）` : ''
}，请生成一封汇总邮件，方便负责人快速了解并决定优先处理哪些。

## 要求
- 使用${target.name}输出
- 先写总体概览：共几封、主要涉及哪些事项、哪些需要尽快处理
- 再按重要程度逐封列出要点：发件人、主题、一句话要点、是否需要回复或跟进
- 只依据邮件内容，不编造未提供的事实、承诺或结论
- 正文输出可用的 HTML 片段（h3 / p / br / ul / ol / li / strong），不要 markdown 代码块
${instruction ? `\n## 额外要求（优先满足）\n${instruction}\n` : ''}
## 未读邮件
${buildDigestMailsText(mails)}`;

const generateDigest = async (fastify, { mails, account, params = {}, target }) => {
  assertAzureChatReady(fastify.config);
  const { chatModel } = createAzureClients(fastify.config);
  const { list, omitted } = pickDigestMails(mails);
  const { object } = await generateObject({
    model: chatModel,
    schema: digestSchema,
    prompt: buildDigestPrompt({
      mails: list,
      omitted,
      accountName: account?.name || account?.address || '当前',
      instruction: String(params.instruction || '').trim(),
      target
    }),
    maxOutputTokens: 4000
  });
  const html = sanitizeHtml(object.html);
  if (!html) {
    throw new Error('AI 生成的汇总内容为空');
  }
  return { subject: String(object.subject || '').trim(), html, count: list.length, omitted };
};

module.exports = {
  MAX_DIGEST_MAILS,
  MAX_MAIL_BRIEF_LENGTH,
  pickDigestMails,
  buildDigestPrompt,
  generateDigest
};
