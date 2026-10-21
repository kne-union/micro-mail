const MAX_BODY_LENGTH = 6000;

const stripHtml = html =>
  String(html || '')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const getMailBody = mail => {
  const text = String(mail.text || '').trim();
  if (text) {
    return text.slice(0, MAX_BODY_LENGTH);
  }
  return stripHtml(mail.html).slice(0, MAX_BODY_LENGTH);
};

const formatAddressList = list =>
  (Array.isArray(list) ? list : [])
    .map(item => {
      if (!item) {
        return '';
      }
      if (typeof item === 'string') {
        return item;
      }
      const name = item.name ? `${item.name} ` : '';
      return item.address ? `${name}<${item.address}>` : name.trim();
    })
    .filter(Boolean)
    .join(', ');

const buildMailBrief = mail => {
  const body = getMailBody(mail);
  return [`Subject: ${mail.subject || '(无主题)'}`, `From: ${formatAddressList(mail.from)}`, `To: ${formatAddressList(mail.to)}`, mail.cc && formatAddressList(mail.cc) ? `Cc: ${formatAddressList(mail.cc)}` : '', '', body || '(正文为空)']
    .filter((line, index, arr) => line !== '' || (index > 0 && arr[index - 1] !== ''))
    .join('\n');
};

// 翻译需要保留段落，块级标签转为换行后再去标签
const getMailPlainText = mail => {
  const text = String(mail.text || '').trim();
  if (text) {
    return text;
  }
  return String(mail.html || '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6]|blockquote)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n\n')
    .trim();
};

const escapeHtml = value =>
  String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const textToHtml = text =>
  String(text || '')
    .split(/\n{2,}/)
    .map(paragraph => paragraph.trim())
    .filter(Boolean)
    .map(paragraph => `<p>${escapeHtml(paragraph).replace(/\n/g, '<br>')}</p>`)
    .join('');

const DEFAULT_LANGUAGE_THRESHOLD = 0.3;

const HAN_PATTERN = /\p{Script=Han}/gu;
const KANA_PATTERN = /[\p{Script=Hiragana}\p{Script=Katakana}]/gu;
const HANGUL_PATTERN = /\p{Script=Hangul}/gu;
const CJK_PATTERN = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu;
const WORD_PATTERN = /[\p{L}\p{M}]+/gu;
const LINK_PATTERN = /https?:\/\/\S+|www\.\S+|[\w.+-]+@[\w-]+\.[\w.-]+/gi;

// 拉丁字母语言无法按字符区分，用常见词与特有字母判定具体语言
const LATIN_LANGUAGE_HINTS = [
  {
    language: 'en',
    words: ['the', 'and', 'of', 'to', 'is', 'are', 'was', 'you', 'your', 'for', 'with', 'this', 'that', 'have', 'will', 'be', 'it', 'we', 'our', 'please', 'thanks', 'from', 'not']
  },
  {
    language: 'fr',
    words: ['le', 'les', 'des', 'est', 'et', 'une', 'vous', 'nous', 'pour', 'avec', 'dans', 'sur', 'pas', 'qui', 'du', 'au', 'aux', 'ce', 'cette', 'je', 'merci', 'bonjour', 'mais', 'être'],
    letters: /[çœàâèêëîïôûù]/
  },
  {
    language: 'de',
    words: ['der', 'die', 'das', 'und', 'ist', 'nicht', 'mit', 'sie', 'ich', 'wir', 'ein', 'eine', 'einen', 'den', 'dem', 'zu', 'auf', 'für', 'bitte', 'danke', 'sehr', 'auch', 'oder', 'sind', 'wird'],
    letters: /[äöüß]/
  },
  {
    language: 'es',
    words: ['el', 'los', 'las', 'y', 'una', 'por', 'para', 'con', 'que', 'del', 'se', 'su', 'sus', 'muy', 'gracias', 'hola', 'usted', 'está', 'pero', 'como', 'más', 'al'],
    letters: /[ñ¿¡áíóú]/
  }
].map(item => Object.assign({}, item, { words: new Set(item.words) }));

const countMatches = (value, pattern) => (value.match(pattern) || []).length;

const detectLatinLanguage = words => {
  let best = { language: 'en', score: 0 };
  LATIN_LANGUAGE_HINTS.forEach(({ language, words: hints, letters }) => {
    const score = words.filter(word => hints.has(word) || (letters && letters.test(word))).length;
    if (score > best.score) {
      best = { language, score };
    }
  });
  return best.language;
};

/**
 * 统计各语言占比：汉字、假名、韩文按字计，其他文字按词计；网址与邮箱地址不计入。
 * 有假名时汉字计入日语；拉丁字母词整体归入判定出的一种拉丁语言。
 * 返回 { ratios: { [语言]: 占比 }, language: 占比最高的语言 }，没有可统计的文字时 language 为 null
 */
const detectLanguage = content => {
  const value = String(content || '').replace(LINK_PATTERN, ' ');
  const han = countMatches(value, HAN_PATTERN);
  const kana = countMatches(value, KANA_PATTERN);
  const hangul = countMatches(value, HANGUL_PATTERN);
  const words = (value.replace(CJK_PATTERN, ' ').match(WORD_PATTERN) || []).map(word => word.toLowerCase());
  const latinWords = words.filter(word => /\p{Script=Latin}/u.test(word));
  const cyrillic = words.filter(word => /\p{Script=Cyrillic}/u.test(word)).length;

  const counts = {
    'zh-CN': kana ? 0 : han,
    ja: kana ? kana + han : 0,
    ko: hangul,
    ru: cyrillic
  };
  if (latinWords.length) {
    counts[detectLatinLanguage(latinWords)] = latinWords.length;
  }

  const total = han + kana + hangul + words.length;
  const ratios = {};
  let language = null;
  Object.keys(counts).forEach(key => {
    ratios[key] = total ? counts[key] / total : 0;
    if (counts[key] && (!language || ratios[key] > ratios[language])) {
      language = key;
    }
  });
  return { ratios, language };
};

// 正文只取纯文本 text，不统计 HTML
const getMailLanguageContent = mail => [mail.subject, mail.text].filter(Boolean).join('\n');

module.exports = {
  MAX_BODY_LENGTH,
  DEFAULT_LANGUAGE_THRESHOLD,
  getMailBody,
  getMailPlainText,
  escapeHtml,
  textToHtml,
  formatAddressList,
  buildMailBrief,
  detectLanguage,
  getMailLanguageContent
};
