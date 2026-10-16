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

module.exports = {
  MAX_BODY_LENGTH,
  getMailBody,
  formatAddressList,
  buildMailBrief
};
