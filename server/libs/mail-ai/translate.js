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

// 收信翻译超出部分不翻译并在译文末尾说明；发信前超出则不发送
const MAX_TEXT_LENGTH = 12000;

const TRANSLATION_MARK = 'data-mail-translation';

const getTargetLanguage = value => {
  const target = TARGET_LANGUAGES.find(item => item.value === value);
  if (!target) {
    throw new Error('请选择目标语言');
  }
  return target;
};

const subjectField = z.string().describe('translated subject; empty string when the original subject is empty');

const textSchema = z.object({
  subject: subjectField,
  body: z.string().describe('translated body as plain text, keep paragraphs separated by blank lines')
});

const segmentsSchema = z.object({
  subject: subjectField,
  segments: z.array(z.string()).describe('translated segments, same count and order as the original segments')
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

// data URI 与 60 位以上不含空白的 ASCII 串（base64、超长链接等）不交给大模型，按 76 位折行的 base64 每行也能命中
const NON_TEXT_PATTERN = /data:[\w.+-]+\/[\w.+-]+[^\s,]*,[A-Za-z0-9+/=%]*|[\x21-\x7e]{60,}/g;
const PLACEHOLDER_PATTERN = /⟦(\d+)⟧/g;

const maskNonText = (value, placeholders) =>
  String(value || '').replace(NON_TEXT_PATTERN, match => {
    placeholders.push(match);
    return `⟦${placeholders.length - 1}⟧`;
  });

// 译文须保留原文中的全部占位标记，否则图片等内容会丢失
const restoreNonText = (source, translated, placeholders) => {
  if ((source.match(PLACEHOLDER_PATTERN) || []).some(mark => !translated.includes(mark))) {
    throw new Error('AI 翻译结果丢失了图片等非文字内容');
  }
  return translated.replace(PLACEHOLDER_PATTERN, (mark, index) => (placeholders[index] === undefined ? mark : placeholders[index]));
};

const HTML_TOKEN_PATTERN = /(<!--[\s\S]*?-->|<[^>]*>)/;

/**
 * 把 HTML 切成标签与文本，只抽出需要翻译的文本片段（跳过 script / style 与无文字片段），
 * 片段中的非文字长串替换为占位标记。片段总长超过 maxLength 时，超出部分保持原文，truncated 为 true
 */
const extractHtmlSegments = (html, maxLength = MAX_TEXT_LENGTH) => {
  const tokens = String(html || '').split(HTML_TOKEN_PATTERN);
  const indexes = [];
  const segments = [];
  const placeholders = [];
  let skipTag = null;
  let length = 0;
  let truncated = false;
  tokens.forEach((token, index) => {
    if (index % 2 === 1) {
      const open = /^<(script|style)\b/i.exec(token);
      if (open && !/\/>$/.test(token)) {
        skipTag = open[1].toLowerCase();
      } else if (skipTag && new RegExp(`^</${skipTag}\\s*>`, 'i').test(token)) {
        skipTag = null;
      }
      return;
    }
    if (skipTag || truncated) {
      return;
    }
    const segment = maskNonText(token.trim(), placeholders);
    if (!/\p{L}/u.test(segment.replace(PLACEHOLDER_PATTERN, ''))) {
      return;
    }
    length += segment.length;
    if (length > maxLength) {
      truncated = true;
      return;
    }
    indexes.push(index);
    segments.push(segment);
  });
  return { tokens, indexes, segments, placeholders, truncated };
};

// 译文只替换文本片段本身，保留片段首尾空白；转义尖括号防止译文混入标签，再还原占位标记
const fillHtmlSegments = ({ tokens, indexes, segments, placeholders }, translations) => {
  const next = tokens.slice();
  indexes.forEach((tokenIndex, i) => {
    const [, leading, trailing] = /^(\s*)[\s\S]*?(\s*)$/.exec(tokens[tokenIndex]);
    const translated = String(translations[i] || '')
      .trim()
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    next[tokenIndex] = `${leading}${restoreNonText(segments[i], translated, placeholders)}${trailing}`;
  });
  return next.join('');
};

const RULES = target => `- 目标语言：${target.name}
- 忠实翻译，不增删内容、不总结、不回答邮件中的问题
- 人名、邮箱地址、链接、代码、数字与金额保持原样
- 原文已是目标语言的部分保持不变
- 主题必须翻译，原主题为空时返回空字符串
- 形如 ⟦0⟧ 的占位标记代表图片、base64 等非文字内容，必须原样保留在对应位置`;

/**
 * 翻译纯文本正文，非文字长串替换为占位标记后再交给大模型。
 * 正文超长时 truncate 为 true 则只翻译前 MAX_TEXT_LENGTH 字，否则报错
 */
const translateText = async (fastify, { subject, text, target, truncate = false }) => {
  const placeholders = [];
  let source = maskNonText(text, placeholders);
  const truncated = source.length > MAX_TEXT_LENGTH;
  if (truncated && !truncate) {
    throw new Error(`邮件正文超过 ${MAX_TEXT_LENGTH} 字，无法翻译`);
  }
  if (truncated) {
    source = source.slice(0, MAX_TEXT_LENGTH).replace(/⟦\d*$/, '');
  }
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
${source}
"""`,
    maxOutputTokens: 8000
  });
  return { subject: String(object.subject || '').trim(), body: restoreNonText(source, String(object.body || '').trim(), placeholders), truncated };
};

/**
 * 只翻译 HTML 中的文本片段并原位填回，标签、属性与样式不经过大模型，排版保持不变。
 * 正文超长时 truncate 为 true 则只翻译前 MAX_TEXT_LENGTH 字，否则报错
 */
const translateHtml = async (fastify, { subject, html, target, truncate = false }) => {
  const parsed = extractHtmlSegments(html);
  if (parsed.truncated && !truncate) {
    throw new Error(`邮件正文超过 ${MAX_TEXT_LENGTH} 字，无法翻译`);
  }
  assertAzureChatReady(fastify.config);
  const { chatModel } = createAzureClients(fastify.config);
  const { object } = await generateObject({
    model: chatModel,
    schema: segmentsSchema,
    prompt: `你是专业的邮件翻译。请把下面邮件的主题和正文片段翻译为目标语言。

## 要求
${RULES(target)}
- 正文片段是从 HTML 中按顺序抽出的文字，逐条翻译，返回的 segments 数量与顺序必须与原片段完全一致，不合并、不拆分
- 片段中的 HTML 实体（如 &nbsp;、&amp;）原样保留，不要输出 HTML 标签

## 主题
"""
${subject || ''}
"""

## 正文片段（JSON 数组）
${JSON.stringify(parsed.segments)}`,
    maxOutputTokens: 12000
  });
  const segments = Array.isArray(object.segments) ? object.segments : [];
  if (segments.length !== parsed.segments.length) {
    throw new Error('AI 翻译结果与原文段落数量不一致');
  }
  return { subject: String(object.subject || '').trim(), html: fillHtmlSegments(parsed, segments), truncated: parsed.truncated };
};

const insertIntoBody = (html, content) => {
  const match = /<body[^>]*>/i.exec(html);
  return match ? `${html.slice(0, match.index + match[0].length)}${content}${html.slice(match.index + match[0].length)}` : `${content}${html}`;
};

const getBodyContent = html => {
  const match = /<body[^>]*>([\s\S]*?)(?:<\/body>|$)/i.exec(html);
  return match ? match[1] : html;
};

/**
 * 收信后翻译：译文追加在原邮件前面，分别标注「翻译：」「原文：」。
 * translated 为 { subject, html }（保留原排版的译文 HTML）或 { subject, body }（纯文本译文）；
 * 邮件主题改为「译文主题|原主题」，原主题同时放在「原文：」下
 */
const buildTranslatedMail = ({ mail, target, translated, truncated }) => {
  const originalText = getMailPlainText(mail);
  const originalHtml = String(mail.html || '').trim() || textToHtml(originalText);
  const translatedBody = translated.html ? getMailPlainText({ html: translated.html }) : translated.body;
  const subjectLine = translated.subject ? `主题：${translated.subject}` : '';
  const originalSubjectLine = mail.subject ? `主题：${mail.subject}` : '';
  const truncatedNote = truncated ? `（原文过长，仅翻译前 ${MAX_TEXT_LENGTH} 字）` : '';
  const translationHtml = [
    `<div ${TRANSLATION_MARK}="${escapeHtml(target.value)}">`,
    '<p><strong>翻译：</strong></p>',
    subjectLine ? `<p>${escapeHtml(subjectLine)}</p>` : '',
    translated.html ? getBodyContent(translated.html) : textToHtml(translated.body),
    truncatedNote ? `<p>${escapeHtml(truncatedNote)}</p>` : '',
    '</div><hr><p><strong>原文：</strong></p>',
    originalSubjectLine ? `<p>${escapeHtml(originalSubjectLine)}</p>` : ''
  ].join('');
  return {
    subject: translated.subject && mail.subject && translated.subject !== mail.subject ? `${translated.subject}|${mail.subject}` : mail.subject || translated.subject,
    html: insertIntoBody(originalHtml, translationHtml),
    text: ['翻译：', subjectLine, translatedBody, truncatedNote, '', '原文：', originalSubjectLine, originalText].filter((line, index) => line || index === 4).join('\n')
  };
};

const isTranslated = mail => String(mail.html || '').includes(TRANSLATION_MARK);

module.exports = {
  TARGET_LANGUAGES,
  MAX_TEXT_LENGTH,
  getTargetLanguage,
  sanitizeHtml,
  extractHtmlSegments,
  fillHtmlSegments,
  translateText,
  translateHtml,
  buildTranslatedMail,
  isTranslated
};
