const fs = require('fs');
const path = require('path');

const REVIEW_SKILL_PATH = path.join(__dirname, '..', 'skills', 'procurement-risk-review', 'SKILL.md');

function loadReviewSkill() {
  try {
    return fs.readFileSync(REVIEW_SKILL_PATH, 'utf8');
  } catch {
    return [
      '# Procurement Risk Review',
      '1. Warn on similar historical procurement and one-year duplicate risk.',
      '2. Warn on amount increase against similar history while ignoring year/period labels.',
      '3. Report prior agency institution and personnel when available.'
    ].join('\n');
  }
}

function compactMatch(match) {
  return {
    score: Number(match.score.toFixed(3)),
    historicalDate: match.historicalDate,
    daysApart: match.daysApart === null ? null : Math.round(match.daysApart),
    projectName: match.row.projectName,
    demandName: match.row.demandName,
    contractName: match.row.contractName,
    productName: match.row.productName,
    productCode: match.row.productCode,
    amount: match.row.demandAmount,
    agencyName: match.row.agencyName,
    agencyPerson: match.row.agencyPerson
  };
}

function buildPrompt(matchResult) {
  const reviewSkill = loadReviewSkill();
  const payload = {
    programRisk: matchResult.programRisk,
    totals: matchResult.totals,
    rows: matchResult.rows.slice(0, 20).map((row) => ({
      current: {
        displayName: row.current.displayName,
        demandName: row.current.demandName,
        projectName: row.current.projectName,
        department: row.current.department,
        approvalTime: row.current.approvalTime,
        catalog: row.current.catalog,
        productName: row.current.productName,
        productCode: row.current.productCode,
        demandAmount: row.current.demandAmount
      },
      flags: row.flags,
      programRisk: row.programRisk,
      duplicateMatches: row.duplicateMatches.slice(0, 3).map(compactMatch),
      olderSimilarMatches: row.olderSimilarMatches.slice(0, 3).map(compactMatch),
      trend: row.trend
        ? {
            direction: row.trend.direction,
            pct: row.trend.pct,
            currentAmount: row.trend.currentAmount,
            historicalAmount: row.trend.historicalAmount,
            sameDuration: row.trend.sameDuration,
            currentDuration: row.trend.currentDuration,
            historicalDuration: row.trend.historicalDuration,
            message: row.trend.message
          }
        : null,
      agencyReminders: row.agencyReminders
    }))
  };

  return [
    {
      role: 'system',
      content:
        `你是公司采购审批风控助手。请只基于用户提供的匹配证据进行分析，不要编造历史数据。输出中文，语气专业、审慎、可执行。\n\n固定评判 skill：\n${reviewSkill}`
    },
    {
      role: 'user',
      content: `请分析以下自动匹配结果，判断采购审批风险，并给出采购部门可执行意见。\n\n要求：\n1. 对一年内疑似重复采购、金额上涨（忽略年份/期间标签）、代理机构/人员重复使用风险分别说明。\n2. 给出 0-100 的 AI 风险分，分值越高风险越高。\n3. 输出严格 JSON，不要包裹 markdown，格式为：{"riskScore":数字,"opinion":"一段综合意见","keyFindings":["要点"],"recommendedActions":["动作"]}。\n\n匹配结果：\n${JSON.stringify(payload, null, 2)}`
    }
  ];
}

function extractJson(content) {
  const trimmed = String(content || '').trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

async function analyzeWithOpenRouter({ apiKey, model, matchResult }) {
  if (!apiKey) {
    return {
      available: false,
      riskScore: matchResult.programRisk,
      opinion: '未配置 OpenRouter API Key，当前仅展示程序自动匹配结果。输入 API Key 后可生成 AI 审批意见。',
      keyFindings: [],
      recommendedActions: [],
      error: null
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45000);

  try {
    const requestBody = {
        model,
        messages: buildPrompt(matchResult),
        temperature: 0.2
      };
    const sendRequest = (withJsonMode) =>
      fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'http://localhost',
          'X-Title': 'Procurement Risk Advisor'
        },
        body: JSON.stringify(
          withJsonMode
            ? { ...requestBody, response_format: { type: 'json_object' } }
            : requestBody
        )
      });

    let response = await sendRequest(true);

    if (!response.ok) {
      const body = await response.text();
      if (/response_format|json_object/i.test(body)) {
        response = await sendRequest(false);
      }

      if (response.ok) {
        const data = await response.json();
        const content = data.choices?.[0]?.message?.content || '';
        const parsed = extractJson(content);

        if (!parsed) {
          return {
            available: true,
            riskScore: matchResult.programRisk,
            opinion: content || 'AI 返回内容为空。',
            keyFindings: [],
            recommendedActions: [],
            error: '模型不支持强制 JSON，降级后返回内容仍不是可解析 JSON。'
          };
        }

        const riskScore = Number(parsed.riskScore);
        return {
          available: true,
          riskScore: Number.isFinite(riskScore) ? Math.max(0, Math.min(100, Math.round(riskScore))) : matchResult.programRisk,
          opinion: parsed.opinion || '',
          keyFindings: Array.isArray(parsed.keyFindings) ? parsed.keyFindings : [],
          recommendedActions: Array.isArray(parsed.recommendedActions) ? parsed.recommendedActions : [],
          error: '模型不支持强制 JSON，已降级为普通请求。'
        };
      }

      throw new Error(`OpenRouter 返回 ${response.status}: ${body.slice(0, 300)}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';
    const parsed = extractJson(content);

    if (!parsed) {
      return {
        available: true,
        riskScore: matchResult.programRisk,
        opinion: content || 'AI 返回内容为空。',
        keyFindings: [],
        recommendedActions: [],
        error: 'AI 返回内容不是可解析 JSON，已保留原始意见。'
      };
    }

    const riskScore = Number(parsed.riskScore);
    return {
      available: true,
      riskScore: Number.isFinite(riskScore) ? Math.max(0, Math.min(100, Math.round(riskScore))) : matchResult.programRisk,
      opinion: parsed.opinion || '',
      keyFindings: Array.isArray(parsed.keyFindings) ? parsed.keyFindings : [],
      recommendedActions: Array.isArray(parsed.recommendedActions) ? parsed.recommendedActions : [],
      error: null
    };
  } catch (error) {
    return {
      available: false,
      riskScore: matchResult.programRisk,
      opinion: 'AI 分析调用失败，当前仅展示程序自动匹配结果。',
      keyFindings: [],
      recommendedActions: [],
      error: error.name === 'AbortError' ? 'OpenRouter 请求超时。' : error.message
    };
  } finally {
    clearTimeout(timeout);
  }
}

function composeFinalRisk(programRisk, aiRisk, aiAvailable) {
  if (!aiAvailable) {
    return {
      score: programRisk,
      formula: '未使用 AI：最终风险暂按程序自动匹配分展示',
      weights: {
        program: 1,
        ai: 0
      }
    };
  }

  return {
    score: Math.round(programRisk * 0.2 + aiRisk * 0.8),
    formula: '程序自动匹配 20% + AI 意见 80%',
    weights: {
      program: 0.2,
      ai: 0.8
    }
  };
}

module.exports = {
  analyzeWithOpenRouter,
  composeFinalRisk
};
