const { z } = require('zod');
const { generateObject } = require('ai');
const { createAzureClients, assertAzureChatReady } = require('../utils/azure-openai');
const { buildMailBrief } = require('./content');

const replySchema = z.object({
  subject: z.string().max(200).describe('reply subject, usually Re: original subject'),
  html: z.string().describe('reply body as simple HTML fragment using p/br/ul/li/strong only, no full html/body')
});

const sanitizeHtml = html =>
  String(html || '')
    .trim()
    .replace(/^```(?:html)?\s*/i, '')
    .replace(/\s*```$/, '')
    .replace(/<(script|style|iframe)[\s\S]*?<\/\1>/gi, '')
    .replace(/\son\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .trim();

const generateAutoReply = async (fastify, { mail, account, params = {}, template = null }) => {
  assertAzureChatReady(fastify.config);
  const { chatModel } = createAzureClients(fastify.config);
  const instruction = String(params.instruction || '').trim();
  const tone = String(params.tone || 'professional').trim() || 'professional';
  const accountName = account?.name || account?.address || '客服';
  const templateSubject = String(template?.subject || '').trim();
  const templateHtml = String(template?.html || '').trim();
  const hasTemplate = !!(templateSubject || templateHtml);

  const { object } = await generateObject({
    model: chatModel,
    schema: replySchema,
    prompt: `你是「${accountName}」邮箱的自动回复助手，请根据来信生成一封合适的回复邮件。

## 要求
- 语气：${tone}（professional=专业礼貌，friendly=友好热情，concise=简洁克制）
- 用与来信相同的主要语言回复（中文来信用中文，英文来信用英文）
- 确认已收到，并针对来信要点做简要回应；不要编造未提供的事实、承诺、价格或内部流程细节
- 不要假装成真人实时在线聊天；明确这是自动回复亦可
- 主题一般为 Re: 原主题；正文输出可用的 HTML 片段（p / br / ul / li / strong），不要 markdown 代码块
${
  hasTemplate
    ? `
## 参考邮件模版（可选，已按变量渲染）
请在保持模版结构、语气与关键表述的基础上，结合来信做个性化改写；不要原样照抄无关占位，也不要丢掉模版里应保留的签名/固定说明。
- 模版主题：${templateSubject || '（无）'}
- 模版正文 HTML：
"""
${templateHtml || '（无）'}
"""
`
    : ''
}
${instruction ? `\n## 额外指示（优先满足）\n${instruction}\n` : ''}
## 来信
"""
${buildMailBrief(mail)}
"""`,
    maxOutputTokens: 1200
  });

  const subject = String(object.subject || '').trim() || templateSubject || `Re: ${mail.subject || ''}`;
  const html = sanitizeHtml(object.html) || sanitizeHtml(templateHtml);
  if (!html) {
    throw new Error('AI 生成的回复内容为空');
  }
  return { subject, html, templateId: template?.id || null };
};

module.exports = {
  generateAutoReply
};
