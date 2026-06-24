/**
 * AI 服务层 - DeepSeek API 集成
 * 用于增强合同分析能力，提供更深入的语义理解
 */

const https = require('https');
const http = require('http');

/**
 * 调用 DeepSeek API 进行合同分析
 * @param {string} text - 合同文本
 * @param {object} contractType - 合同类型信息
 * @returns {Promise<object>} AI 分析结果
 */
async function analyzeWithDeepSeek(text, contractType) {
  const apiKey = process.env.AI_API_KEY;
  const apiUrl = process.env.AI_API_URL || 'https://api.deepseek.com/v1/chat/completions';
  const model = process.env.AI_MODEL || 'deepseek-chat';

  if (!apiKey) {
    throw new Error('未配置 AI_API_KEY，请在 .env 文件中设置');
  }

  // 截取合同文本（避免超出 token 限制）
  const maxTextLength = 8000;
  const contractText = text.length > maxTextLength
    ? text.substring(0, maxTextLength) + '\n...(以下内容已截断)'
    : text;

  const systemPrompt = `你是一位专业的中国法律顾问，擅长识别合同中的陷阱条款和风险点。

你的任务是分析用户提供的合同文本，找出所有潜在的风险条款，并给出专业建议。

请严格按照以下 JSON 格式输出分析结果（不要输出任何其他内容，只输出纯 JSON）：
{
  "traps": [
    {
      "name": "风险条款名称（简短）",
      "severity": "high/medium/low",
      "category": "unfair/financial/restriction/legal/dispute/privacy/ambiguous/missing",
      "description": "风险描述（一句话说明问题所在）",
      "suggestion": "修改建议（具体可操作的建议）",
      "legalBasis": "相关法律依据（具体法条）",
      "matchedClause": "合同中的原文（直接引用）"
    }
  ],
  "summary": "整体风险评估摘要（100字以内）"
}

注意事项：
1. severity 只能是 high、medium、low 之一
2. 只报告真正有风险的条款，不要报告正常的合同条款
3. matchedClause 必须是合同原文中的直接引用
4. legalBasis 必须引用具体的法律条文
5. suggestion 必须具体可操作，不要泛泛而谈
6. 合同类型为：${contractType.name}`;

  const userPrompt = `请分析以下${contractType.name}中的风险条款：\n\n${contractText}`;

  const requestBody = JSON.stringify({
    model: model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ],
    temperature: 0.1,  // 低温度，保证输出稳定
    max_tokens: 4000,
    response_format: { type: 'json_object' }
  });

  return new Promise((resolve, reject) => {
    const url = new URL(apiUrl);
    const isHttps = url.protocol === 'https:';
    const client = isHttps ? https : http;

    const options = {
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname + url.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'Content-Length': Buffer.byteLength(requestBody)
      },
      timeout: 15000  // 15秒超时，快速降级
    };

    const req = client.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const response = JSON.parse(data);

          if (response.error) {
            console.error('DeepSeek API 错误:', response.error);
            reject(new Error('AI 分析服务返回错误: ' + (response.error.message || '未知错误')));
            return;
          }

          const content = response.choices?.[0]?.message?.content;
          if (!content) {
            reject(new Error('AI 分析服务返回空结果'));
            return;
          }

          // 解析 AI 返回的 JSON
          const aiResult = JSON.parse(content);
          resolve(aiResult);

        } catch (parseError) {
          console.error('解析 AI 响应失败:', parseError.message);
          console.error('原始响应:', data.substring(0, 500));
          reject(new Error('AI 分析结果解析失败'));
        }
      });
    });

    req.on('error', (error) => {
      console.error('DeepSeek API 请求失败:', error.message);
      reject(new Error('AI 分析服务连接失败: ' + error.message));
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('AI 分析服务请求超时'));
    });

    req.write(requestBody);
    req.end();
  });
}

/**
 * 将 AI 分析结果标准化为统一格式
 */
function normalizeAIResult(aiResult, contractType) {
  const traps = [];

  if (aiResult.traps && Array.isArray(aiResult.traps)) {
    for (const trap of aiResult.traps) {
      traps.push({
        id: 'ai-' + Date.now() + '-' + Math.random().toString(36).substr(2, 6),
        name: trap.name || '未命名风险',
        severity: ['high', 'medium', 'low'].includes(trap.severity) ? trap.severity : 'medium',
        category: trap.category || 'unfair',
        description: trap.description || '',
        suggestion: trap.suggestion || '',
        legalBasis: trap.legalBasis || '',
        matchedClauses: trap.matchedClause ? [trap.matchedClause] : [],
        matchCount: trap.matchedClause ? 1 : 0,
        source: 'ai'  // 标记来源为 AI
      });
    }
  }

  return {
    traps,
    summary: aiResult.summary || '',
    source: 'deepseek'
  };
}

module.exports = { analyzeWithDeepSeek, normalizeAIResult };
