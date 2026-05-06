const fs = require('fs');
const path = require('path');

const REVIEW_SKILL_PATH = path.join(__dirname, '..', 'skills', 'procurement-risk-review', 'SKILL.md');

const FORBIDDEN_DURATION_PATTERNS = [
  /距今[^，。；\n]{0,12}(?:超过|不足|已过|已超|刚过|约|大约)?[^，。；\n]{0,4}(?:一年|半年|[一二三四五六七八九十百千两\d]+\s*(?:年|个月|月|天|日))/,
  /(?:已|早已|远)?(?:过去|超过)\s*(?:一年|半年|[一二三四五六七八九十百千两\d]+\s*(?:年|个月|月))/,
  /(?:今年|去年|前年|大前年)/
];

const DUPLICATE_WORRY_PATTERN = /(?:避免|防止|防范|杜绝|核实是否).{0,16}(?:重复采购|采购重复|重复立项|重复支出|范围重叠)|(?:范围|内容).{0,8}重叠.{0,8}(?:避免|防止|防范|核实)/;

const AMOUNT_WORRY_PATTERN = /(?:解释|说明|核实).{0,12}(?:金额上涨|涨幅|价格上涨|金额增加)|涨幅.{0,8}(?:依据|说明|合理性)/;

const AGENCY_WORRY_PATTERN = /(?:保持|确保|维持).{0,8}代理(?:机构)?.{0,8}(?:独立|多元)|代理机构.{0,8}选用.{0,8}(?:独立|多元)/;

function loadReviewSkill() {
  try {
    return fs.readFileSync(REVIEW_SKILL_PATH, 'utf8');
  } catch {
    return [
      '# Procurement Risk Review',
      '严格按照程序提供的 criteria.triggered/determinate 复述判定，不得自行计算日期或编造记录。'
    ].join('\n');
  }
}

function compactMatch(match) {
  return {
    score: Number(match.score.toFixed(3)),
    historicalDate: match.historicalDate || null,
    daysApart: match.daysApart === null ? null : Math.round(match.daysApart),
    projectName: match.row.projectName || '',
    demandName: match.row.demandName || '',
    contractName: match.row.contractName || '',
    productName: match.row.productName || '',
    productCode: match.row.productCode || '',
    amount: match.row.demandAmount || '',
    agencyName: match.row.agencyName || '',
    agencyPerson: match.row.agencyPerson || ''
  };
}

function compactRow(row) {
  return {
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
    referenceDate: row.referenceDate,
    criteria: row.criteria,
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
          message: row.trend.message
        }
      : null,
    agencyReminders: row.agencyReminders
  };
}

function buildPrompt(matchResult, todayIso) {
  const reviewSkill = loadReviewSkill();
  const payload = {
    referenceDate: { today: todayIso },
    programRisk: matchResult.programRisk,
    totals: matchResult.totals,
    rows: matchResult.rows.slice(0, 20).map(compactRow)
  };

  return [
    {
      role: 'system',
      content: [
        '你是公司采购审批风控助手。严格遵循 procurement-risk-review skill。',
        '',
        '硬性约束：',
        '1) criteria.triggered 与 criteria.determinate 是程序计算出的事实，不得改变结论；',
        '2) 不得自行计算"距今 X 年/月/天"，需要谈区间时只能引用 daysApart；',
        '3) triggered=false 时禁止给出对应风险的"避免/防止/核实是否重复"建议；',
        '4) 同样的输入必须产出同样的输出；不要装饰性措辞。',
        '',
        '今日日期：' + todayIso,
        '',
        reviewSkill
      ].join('\n')
    },
    {
      role: 'user',
      content: [
        '请基于下方程序匹配结果生成审批意见。',
        '',
        '输出严格 JSON（无 markdown，无解释，无多余字段）：',
        '{"riskScore":数字,"opinion":"一段中文，三句分别对应 重复采购 / 金额 / 代理 三项判定","keyFindings":["仅含 triggered=true 的要点"],"recommendedActions":["仅含 triggered=true 或 determinate=false 的动作"]}',
        '',
        '匹配结果：',
        JSON.stringify(payload, null, 2)
      ].join('\n')
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

function aggregateCriteria(matchResult) {
  let dupTriggered = false;
  let dupIndeterminate = false;
  let amtTriggered = false;
  let amtIndeterminate = false;
  let agencyTriggered = false;

  for (const row of matchResult.rows) {
    const criteria = row.criteria || {};
    const dup = criteria.duplicateWithinOneYear || {};
    const amt = criteria.amountIncrease || {};
    const agency = criteria.agencyReminder || {};

    if (dup.triggered) dupTriggered = true;
    else if (dup.determinate === false) dupIndeterminate = true;

    if (amt.triggered) amtTriggered = true;
    else if (amt.determinate === false) amtIndeterminate = true;

    if (agency.triggered) agencyTriggered = true;
  }

  return {
    dupTriggered,
    dupIndeterminate,
    amtTriggered,
    amtIndeterminate,
    agencyTriggered
  };
}

function deterministicNarrative(matchResult) {
  const lines = [];
  const findings = [];
  const actions = [];

  for (const row of matchResult.rows) {
    const title =
      row.current.projectName ||
      row.current.demandName ||
      row.current.contractName ||
      row.current.displayName ||
      '本次采购';
    const criteria = row.criteria || {};
    const dup = criteria.duplicateWithinOneYear || {};
    const amt = criteria.amountIncrease || {};
    const agency = criteria.agencyReminder || {};

    const sentences = [];
    sentences.push(
      dup.triggered
        ? `一年内重复采购：${dup.reason}`
        : dup.determinate === false
          ? `一年内重复采购：${dup.reason}`
          : `一年内重复采购：${dup.reason}`
    );
    sentences.push(`金额变化：${amt.reason}`);
    sentences.push(`代理机构/人员：${agency.reason}`);

    lines.push(`【${title}】${sentences.join(' ')}`);

    if (dup.triggered) {
      findings.push(`一年内疑似重复采购：${dup.reason}`);
      actions.push('请采购部门核实本次需求与一年内同类历史采购的必要性差异。');
    } else if (dup.determinate === false) {
      findings.push(`一年内重复采购无法按日期判定：${dup.reason}`);
      actions.push('请人工核实历史项目与本次采购的关联度（程序无法仅凭日期判定）。');
    }

    if (amt.triggered) {
      findings.push(`同类历史金额上涨：${amt.reason}`);
      actions.push('请补充本次金额上涨的具体说明（需求规模、规格、材质等）及预算审批依据。');
    }

    if (agency.triggered) {
      findings.push(`历史代理机构/人员提醒：${agency.reason}`);
      actions.push('选用代理机构时请关注与历史项目的独立性，避免长期依赖同一机构。');
    }
  }

  const opinion = lines.join(' ');
  return {
    opinion: opinion || '程序未生成可用证据。',
    keyFindings: findings,
    recommendedActions: actions
  };
}

function sanitizeAiOutput(parsed, matchResult) {
  const aggregate = aggregateCriteria(matchResult);
  const fallback = deterministicNarrative(matchResult);
  const issues = [];

  let opinion = String(parsed?.opinion ?? '').trim();
  let findings = Array.isArray(parsed?.keyFindings)
    ? parsed.keyFindings.map((item) => String(item).trim()).filter(Boolean)
    : [];
  let actions = Array.isArray(parsed?.recommendedActions)
    ? parsed.recommendedActions.map((item) => String(item).trim()).filter(Boolean)
    : [];

  const opinionViolatesDuration = FORBIDDEN_DURATION_PATTERNS.some((pattern) => pattern.test(opinion));
  const opinionViolatesNoDuplicate =
    !aggregate.dupTriggered && !aggregate.dupIndeterminate && DUPLICATE_WORRY_PATTERN.test(opinion);
  const opinionViolatesNoAgency = !aggregate.agencyTriggered && AGENCY_WORRY_PATTERN.test(opinion);

  if (opinionViolatesDuration) issues.push('opinion 含自行计算的时间区间表述，已替换为程序文本。');
  if (opinionViolatesNoDuplicate) issues.push('opinion 在无一年内重复风险时仍提及避免重复采购，已替换为程序文本。');
  if (opinionViolatesNoAgency) issues.push('opinion 在无代理提醒时仍要求保持独立性，已替换为程序文本。');

  if (opinionViolatesDuration || opinionViolatesNoDuplicate || opinionViolatesNoAgency || !opinion) {
    opinion = fallback.opinion;
  }

  const cleanList = (list, label) => {
    const removed = [];
    const kept = list.filter((item) => {
      if (FORBIDDEN_DURATION_PATTERNS.some((pattern) => pattern.test(item))) {
        removed.push(item);
        return false;
      }
      if (!aggregate.dupTriggered && !aggregate.dupIndeterminate && DUPLICATE_WORRY_PATTERN.test(item)) {
        removed.push(item);
        return false;
      }
      if (!aggregate.amtTriggered && !aggregate.amtIndeterminate && AMOUNT_WORRY_PATTERN.test(item)) {
        removed.push(item);
        return false;
      }
      if (!aggregate.agencyTriggered && AGENCY_WORRY_PATTERN.test(item)) {
        removed.push(item);
        return false;
      }
      return true;
    });
    if (removed.length) {
      issues.push(`${label} 移除 ${removed.length} 项与 criteria 冲突的条目。`);
    }
    return kept;
  };

  findings = cleanList(findings, 'keyFindings');
  actions = cleanList(actions, 'recommendedActions');

  if (!findings.length && fallback.keyFindings.length) {
    findings = fallback.keyFindings;
  }
  if (!actions.length && fallback.recommendedActions.length) {
    actions = fallback.recommendedActions;
  }

  return {
    opinion,
    keyFindings: findings,
    recommendedActions: actions,
    issues
  };
}

async function analyzeWithOpenRouter({ apiKey, model, matchResult, todayIso }) {
  const today = todayIso || new Date().toISOString().slice(0, 10);
  const fallback = deterministicNarrative(matchResult);

  if (!apiKey) {
    return {
      available: false,
      riskScore: matchResult.programRisk,
      opinion: '未配置 OpenRouter API Key，以下意见基于程序自动匹配生成：' + fallback.opinion,
      keyFindings: fallback.keyFindings,
      recommendedActions: fallback.recommendedActions,
      error: null
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45000);

  try {
    const requestBody = {
      model,
      messages: buildPrompt(matchResult, today),
      temperature: 0
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
    let downgraded = false;

    if (!response.ok) {
      const body = await response.text();
      if (/response_format|json_object/i.test(body)) {
        response = await sendRequest(false);
        downgraded = true;
      } else {
        throw new Error(`OpenRouter 返回 ${response.status}: ${body.slice(0, 300)}`);
      }
    }

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`OpenRouter 返回 ${response.status}: ${body.slice(0, 300)}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';
    const parsed = extractJson(content);

    if (!parsed) {
      return {
        available: true,
        riskScore: matchResult.programRisk,
        opinion: fallback.opinion,
        keyFindings: fallback.keyFindings,
        recommendedActions: fallback.recommendedActions,
        error: 'AI 返回内容不是可解析 JSON，已使用程序确定性意见兜底。'
      };
    }

    const sanitized = sanitizeAiOutput(parsed, matchResult);
    const rawScore = Number(parsed.riskScore);
    const riskScore = Number.isFinite(rawScore)
      ? Math.max(0, Math.min(100, Math.round(rawScore)))
      : matchResult.programRisk;

    const errorParts = [];
    if (downgraded) errorParts.push('模型不支持强制 JSON，已降级为普通请求。');
    if (sanitized.issues.length) errorParts.push(sanitized.issues.join(' '));

    return {
      available: true,
      riskScore,
      opinion: sanitized.opinion,
      keyFindings: sanitized.keyFindings,
      recommendedActions: sanitized.recommendedActions,
      error: errorParts.length ? errorParts.join(' ') : null
    };
  } catch (error) {
    return {
      available: false,
      riskScore: matchResult.programRisk,
      opinion: 'AI 分析调用失败，以下意见基于程序自动匹配生成：' + fallback.opinion,
      keyFindings: fallback.keyFindings,
      recommendedActions: fallback.recommendedActions,
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
  composeFinalRisk,
  deterministicNarrative,
  sanitizeAiOutput,
  FORBIDDEN_DURATION_PATTERNS,
  DUPLICATE_WORRY_PATTERN,
  AMOUNT_WORRY_PATTERN,
  AGENCY_WORRY_PATTERN
};
