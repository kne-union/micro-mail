const { z } = require('zod');
const { generateObject } = require('ai');
const { createAzureClients, assertAzureChatReady } = require('../utils/azure-openai');
const { getMailPlainText, escapeHtml, textToHtml } = require('./content');

const TARGET_LANGUAGES = [
  { value: 'zh-CN', label: '简体中文', name: 'Simplified Chinese' },
  { value: 'en', label: '英语', name: 'English' },
  { value: 'ja', label: '日语', name: 'Japanese' },
  { value: 'ko', label: '韩语', name: 'Korean' },
  { value: 'fr', label: '法语', name: 'French' },
  { value: 'de', label: '德语', name: 'German' },
  { value: 'es', label: '西班牙语', name: 'Spanish' },
  { value: 'ru', label: '俄语', name: 'Russian' }
];

// 收信翻译超出部分不翻译并在译文末尾说明；发信前 HTML 超出时改为按纯文本翻译
const MAX_TEXT_LENGTH = 12000;
const MAX_HTML_LENGTH = 20000;

const TRANSLATION_MARK = 'data-mail-translation';

const getTargetLanguage = value => {
  const target = TARGET_LANGUAGES.find(item => item.value === value);
  if (!target) {
    throw new Error('请选择目标语言');
  }
  return target;
};

const textSchema = z.object({
  subject: z.string().describe('translated subject; empty string when the original subject is empty'),
  body: z.string().describe('translated body as plain text, keep paragraphs separated by blank lines')
});

const htmlSchema = z.object({
  subject: z.string().describe('translated subject; empty string when the original subject is empty'),
  html: z.string().describe('translated HTML with exactly the same tags and attributes as the original')
});

const sanitizeHtml = html =>
  String(html || '')
    .trim()
    .replace(/^```(?:html)?\s*/i, '')
    .replace(/\s*```$/, '')
    .replace(/<(script|style|iframe|object|embed|form)[\s\S]*?<\/\1>/gi, '')
    .replace(/<(script|iframe|object|embed|form|base|meta|link)\b[^>]*>/gi, '')
    .replace(/\son\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/\s(href|src)\s*=\s*(["']?)\s*javascript:[^"'\s>]*\2/gi, '')
    .trim();

const RULES = target => `- 目标语言：${target.name}
- 忠实翻译，不增删内容、不总结、不回答邮件中的问题
- 人名、邮箱地址、链接、代码、数字与金额保持原样
- 原文已是目标语言的部分保持不变`;

const translateText = async (fastify, { subject, text, target }) => {
  assertAzureChatReady(fastify.config);
  const { chatModel } = createAzureClients(fastify.config);
  const { object } = await generateObject({
    model: chatModel,
    schema: textSchema,
    prompt: `你是专业的邮件翻译。请把下面邮件的主题和正文翻译为目标语言。

## 要求
${RULES(target)}
- 正文输出纯文本，保留原有分段（段落之间空一行）

## 主题
"""
${subject || ''}
"""

## 正文
"""
${text}
"""`,
    maxOutputTokens: 8000
  });
  return { subject: String(object.subject || '').trim(), body: String(object.body || '').trim() };
};

const translateHtml = async (fastify, { subject, html, target }) => {
  assertAzureChatReady(fastify.config);
  const { chatModel } = createAzureClients(fastify.config);
  const { object } = await generateObject({
    model: chatModel,
    schema: htmlSchema,
    prompt: `你是专业的邮件翻译。请把下面邮件的主题和 HTML 正文翻译为目标语言。

## 要求
${RULES(target)}
- 只翻译 HTML 中的文字内容，所有标签、属性与内联样式原样保留，不新增标签，不输出 markdown 代码块

## 主题
"""
${subject || ''}
"""

## HTML 正文
"""
${html}
"""`,
    maxOutputTokens: 12000
  });
  return { subject: String(object.subject || '').trim(), html: sanitizeHtml(object.html) };
};

const insertIntoBody = (html, content) => {
  const match = /<body[^>]*>/i.exec(html);
  return match ? `${html.slice(0, match.index + match[0].length)}${content}${html.slice(match.index + match[0].length)}` : `${content}${html}`;
};

/**
 * 收信后翻译：译文追加在原邮件前面，分别标注「翻译：」「原文：」
 */
const buildTranslatedMail = ({ mail, target, translated, truncated }) => {
  const originalText = getMailPlainText(mail);
  const originalHtml = String(mail.html || '').trim() || textToHtml(originalText);
  const subjectLine = translated.subject ? `主题：${translated.subject}` : '';
  const truncatedNote = truncated ? `（原文过长，仅翻译前 ${MAX_TEXT_LENGTH} 字）` : '';
  const translationHtml = [
    `<div ${TRANSLATION_MARK}="${escapeHtml(target.value)}">`,
    '<p><strong>翻译：</strong></p>',
    subjectLine ? `<p>${escapeHtml(subjectLine)}</p>` : '',
    textToHtml(translated.body),
    truncatedNote ? `<p>${escapeHtml(truncatedNote)}</p>` : '',
    '</div><hr><p><strong>原文：</strong></p>'
  ].join('');
  return {
    html: insertIntoBody(originalHtml, translationHtml),
    text: ['翻译：', subjectLine, translated.body, truncatedNote, '', '原文：', originalText].filter((line, index) => line || index === 4).join('\n')
  };
};

const isTranslated = mail => String(mail.html || '').includes(TRANSLATION_MARK);

module.exports = {
  TARGET_LANGUAGES,
  MAX_TEXT_LENGTH,
  MAX_HTML_LENGTH,
  getTargetLanguage,
  sanitizeHtml,
  translateText,
  translateHtml,
  buildTranslatedMail,
  isTranslated
};
