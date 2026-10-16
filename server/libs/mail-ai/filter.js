const { z } = require('zod');
const { generateObject } = require('ai');
const { createAzureClients, assertAzureChatReady } = require('../utils/azure-openai');
const { buildMailBrief } = require('./content');

const filterSchema = z.object({
  matched: z.boolean().describe('true when the email matches the user-provided screening criteria'),
  confidence: z.number().min(0).max(1).describe('confidence between 0 and 1'),
  reason: z.string().max(200).describe('short reason in the same language as the criteria / email when possible')
});

const judgeByCriteria = async (fastify, { mail, params = {} }) => {
  assertAzureChatReady(fastify.config);
  const criteria = String(params.criteria || '').trim();
  if (!criteria) {
    throw new Error('请填写筛选内容');
  }
  const threshold = Math.min(1, Math.max(0, Number(params.minConfidence == null || params.minConfidence === '' ? 0.6 : params.minConfidence)));
  const { chatModel } = createAzureClients(fastify.config);

  const { object } = await generateObject({
    model: chatModel,
    schema: filterSchema,
    prompt: `你是邮件筛选助手。请根据用户给出的「筛选内容」，判断下面这封邮件是否命中该筛选条件。

## 筛选内容（用户定义，严格按此判断，不限于垃圾邮件）
"""
${criteria}
"""

## 规则
- matched=true 表示邮件符合上述筛选内容
- matched=false 表示不符合
- 只依据邮件本身与筛选内容判断，不要擅自扩大或缩小筛选范围
- 筛选内容语义不清时，宁可判定为不命中

## 邮件内容
"""
${buildMailBrief(mail)}
"""

输出结构化结果。`,
    maxOutputTokens: 400
  });

  const matched = !!object.matched && Number(object.confidence || 0) >= threshold;
  return {
    matched,
    reason: object.reason || (matched ? 'AI 判定命中筛选条件' : 'AI 判定未命中筛选条件'),
    confidence: Number(object.confidence || 0),
    threshold
  };
};

module.exports = {
  judgeByCriteria
};
