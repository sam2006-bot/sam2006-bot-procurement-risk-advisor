const GENERIC_WORDS = [
  '关于',
  '采购',
  '项目',
  '需求',
  '申请',
  '请购',
  '方案',
  '合同',
  '框架',
  '协议',
  '服务',
  '中国移动',
  '安徽移动',
  '安徽公司',
  '淮南移动',
  '淮南分公司',
  '公司',
  '分公司',
  '年度',
  '一批',
  '确定',
  '请示',
  '优化'
];

function cleanText(value, options = {}) {
  const removeYears = options.removeYears !== false;
  let text = String(value || '')
    .toLowerCase()
    .replace(/[（(][^）)]{0,30}[）)]/g, '')
    .replace(/[【】「」『』\[\]{}]/g, '')
    .replace(/\s+/g, '');

  if (removeYears) {
    text = text
      .replace(/20\d{2}\s*年?\s*(?:-|－|—|–|~|至|到)\s*20\d{2}\s*年?/g, '')
      .replace(/20\d{2}\s*年?/g, '')
      .replace(/\d{1,2}\s*月/g, '')
      .replace(/\d{1,2}\s*日/g, '');
  }

  for (const word of GENERIC_WORDS) {
    text = text.replaceAll(word, '');
  }

  return text.replace(/[^\p{Script=Han}a-z0-9]+/gu, '');
}

function grams(text) {
  const normalized = cleanText(text);
  if (!normalized) return [];
  if (normalized.length <= 2) return [normalized];

  const result = [];
  for (let i = 0; i < normalized.length - 1; i += 1) {
    result.push(normalized.slice(i, i + 2));
  }
  return result;
}

function diceCoefficient(left, right) {
  const a = grams(left);
  const b = grams(right);
  if (!a.length || !b.length) return 0;

  const counts = new Map();
  for (const gram of a) {
    counts.set(gram, (counts.get(gram) || 0) + 1);
  }

  let matches = 0;
  for (const gram of b) {
    const count = counts.get(gram) || 0;
    if (count > 0) {
      matches += 1;
      counts.set(gram, count - 1);
    }
  }

  return (2 * matches) / (a.length + b.length);
}

function maxSimilarity(leftValues, rightValues) {
  let max = 0;
  let pair = ['', ''];

  for (const left of leftValues.filter(Boolean)) {
    for (const right of rightValues.filter(Boolean)) {
      const score = diceCoefficient(left, right);
      if (score > max) {
        max = score;
        pair = [left, right];
      }
    }
  }

  return { score: max, pair };
}

function numericAmount(value) {
  if (value === null || value === undefined) return null;
  const normalized = String(value).replace(/[,，¥￥\s]/g, '');
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseProcurementDate(value) {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;

  const text = String(value).trim();
  if (/^\d{5}(?:\.\d+)?$/.test(text)) {
    const serial = Number(text);
    const milliseconds = Math.round((serial - 25569) * 86400000);
    const date = new Date(milliseconds);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const match = text.match(/(20\d{2})[-/年.](\d{1,2})[-/月.](\d{1,2})/);
  if (!match) return null;

  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.getTime()) ? null : date;
}

function rowDate(row) {
  return parseProcurementDate(row.approvalTime) || parseProcurementDate(row.projectTime);
}

function daysBetween(left, right) {
  if (!left || !right) return null;
  return Math.abs(left.getTime() - right.getTime()) / 86400000;
}

function textCorpus(row) {
  return [
    row.demandName,
    row.projectName,
    row.contractName,
    row.productName,
    row.catalog,
    row.department
  ]
    .filter(Boolean)
    .join(' ');
}

function durationYears(row) {
  const text = textCorpus(row);
  const span = text.match(/(20\d{2})\s*年?\s*(?:-|－|—|–|~|至|到)\s*(20\d{2})\s*年?/);
  if (span) {
    const start = Number(span[1]);
    const end = Number(span[2]);
    if (end >= start && end - start < 10) {
      return {
        value: end - start + 1,
        label: `${start}-${end}年`
      };
    }
  }

  const explicitYear = text.match(/(?:^|[^\d])([1-9](?:\.\d+)?)\s*年(?!\d)/);
  if (explicitYear) {
    return {
      value: Number(explicitYear[1]),
      label: `${explicitYear[1]}年`
    };
  }

  const explicitMonth = text.match(/(?:^|[^\d])([1-9]\d?)\s*个?月/);
  if (explicitMonth) {
    const months = Number(explicitMonth[1]);
    return {
      value: Math.round((months / 12) * 100) / 100,
      label: `${months}个月`
    };
  }

  return {
    value: null,
    label: '未识别'
  };
}

function rowAmount(row) {
  return (
    numericAmount(row.demandAmount) ??
    numericAmount(row.resultAmountTax) ??
    numericAmount(row.resultAmountNoTax)
  );
}

function hasAnyTerm(text, terms) {
  return terms.some((term) => text.includes(term));
}

function hasProcurementNatureConflict(current, historical) {
  const currentText = cleanText(textCorpus(current), { removeYears: false });
  const historicalText = cleanText(textCorpus(historical), { removeYears: false });
  const maintenanceTerms = ['维保', '维护', '维修', '保修', '运维'];
  const expansionTerms = ['扩容', '扩建', '新增', '新建'];

  return (
    (hasAnyTerm(currentText, maintenanceTerms) && hasAnyTerm(historicalText, expansionTerms)) ||
    (hasAnyTerm(currentText, expansionTerms) && hasAnyTerm(historicalText, maintenanceTerms))
  );
}

function compareRows(current, historical) {
  const nameValuesCurrent = [current.demandName, current.projectName, current.contractName];
  const nameValuesHistorical = [historical.demandName, historical.projectName, historical.contractName];
  const name = maxSimilarity(nameValuesCurrent, nameValuesHistorical);
  const productName = maxSimilarity([current.productName], [historical.productName]);
  const catalog = diceCoefficient(current.catalog, historical.catalog);
  const department = diceCoefficient(current.department, historical.department);

  const productCodeExact =
    current.productCode && historical.productCode && current.productCode === historical.productCode;
  const productScore = Math.max(productName.score, productCodeExact ? 1 : 0);

  let score = name.score * 0.56 + productScore * 0.25 + catalog * 0.12 + department * 0.07;

  if (productCodeExact && name.score >= 0.22) score += 0.08;
  if (current.supplier && current.supplier === historical.supplier) score += 0.03;
  score = Math.min(1, score);

  return {
    score,
    nameScore: name.score,
    productScore,
    catalogScore: catalog,
    departmentScore: department,
    productCodeExact: Boolean(productCodeExact),
    matchedNamePair: name.pair
  };
}

function isCandidate(match) {
  return (
    match.score >= 0.32 ||
    (match.productCodeExact && match.nameScore >= 0.2) ||
    (match.nameScore >= 0.52 && match.productScore >= 0.2)
  );
}

function formatCurrency(amount) {
  if (amount === null || amount === undefined || !Number.isFinite(amount)) return '未知';
  return new Intl.NumberFormat('zh-CN', {
    style: 'currency',
    currency: 'CNY',
    maximumFractionDigits: 0
  }).format(amount);
}

function summarizeTrend(current, candidates) {
  const currentDuration = durationYears(current);
  const currentAmount = rowAmount(current);
  if (!candidates.length || currentAmount === null) return null;

  const preferred = candidates[0] || null;
  const preferredScore = preferred?.score || 0;
  const comparable = candidates
    .map((candidate) => {
      const historicalDuration = durationYears(candidate.row);
      const historicalAmount = rowAmount(candidate.row);
      const sameDuration =
        currentDuration.value !== null &&
        historicalDuration.value !== null &&
        Math.abs(currentDuration.value - historicalDuration.value) <= 0.25;

      return {
        ...candidate,
        historicalDuration,
        historicalAmount,
        sameDuration
      };
    })
    .filter((candidate) => {
      if (candidate.historicalAmount === null) return false;
      if (hasProcurementNatureConflict(current, candidate.row)) return false;
      if (preferred && candidate.row === preferred.row) return true;

      const closeToPreferred = candidate.score >= Math.max(0.45, preferredScore - 0.16);
      const strongNameMatch = candidate.nameScore >= 0.72;
      return closeToPreferred || strongNameMatch || candidate.productCodeExact;
    });

  const selected = comparable[0] || null;

  if (!selected) return null;

  const delta = currentAmount - selected.historicalAmount;
  const pct = selected.historicalAmount === 0 ? null : delta / selected.historicalAmount;
  let direction = '持平';
  if (pct !== null && pct > 0.03) direction = '上涨';
  if (pct !== null && pct < -0.03) direction = '下降';
  const durationNote = selected.sameDuration ? '' : '已忽略年份/期间影响，仅按同类历史金额变化提示。';

  return {
    direction,
    delta,
    pct,
    currentAmount,
    historicalAmount: selected.historicalAmount,
    currentDuration,
    historicalDuration: selected.historicalDuration,
    sameDuration: selected.sameDuration,
    matchedHistorical: selected.row,
    matchedScore: selected.score,
    message:
      direction === '上涨'
        ? `同类历史采购金额为 ${formatCurrency(selected.historicalAmount)}，本次为 ${formatCurrency(currentAmount)}，金额上涨${pct === null ? '' : ` ${(pct * 100).toFixed(1)}%`}。${durationNote}`
        : direction === '下降'
          ? `同类历史采购金额为 ${formatCurrency(selected.historicalAmount)}，本次为 ${formatCurrency(currentAmount)}，金额下降${pct === null ? '' : ` ${Math.abs(pct * 100).toFixed(1)}%`}。${durationNote}`
          : `同类历史采购金额为 ${formatCurrency(selected.historicalAmount)}，本次为 ${formatCurrency(currentAmount)}，基本持平。${durationNote}`
  };
}

function summarizeAgency(candidates) {
  const seen = new Set();
  return candidates
    .filter((candidate) => candidate.row.agencyName || candidate.row.agencyPerson)
    .map((candidate) => ({
      agencyName: candidate.row.agencyName || '未填机构',
      agencyPerson: candidate.row.agencyPerson || '未填负责人',
      historicalProject: candidate.row.projectName || candidate.row.demandName || candidate.row.contractName,
      historicalDate: candidate.row.approvalTime || candidate.row.projectTime || '',
      score: candidate.score
    }))
    .filter((item) => {
      const key = `${item.agencyName}|${item.agencyPerson}|${item.historicalProject}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 5);
}

function programRiskForRow({ duplicateMatches, candidates, trend, agencyReminders }) {
  let risk = 0;

  if (duplicateMatches.length) {
    risk = Math.max(risk, 68 + Math.round(duplicateMatches[0].score * 24));
  } else if (candidates.length) {
    risk = Math.max(risk, 24 + Math.round(candidates[0].score * 28));
  }

  if (trend?.direction === '上涨') {
    const pctBoost = trend.pct !== null && trend.pct > 0.2 ? 14 : 9;
    risk += pctBoost;
  }

  if (agencyReminders.length) risk += 4;
  return Math.max(0, Math.min(100, risk));
}

function rowTitle(row) {
  return (
    row.projectName ||
    row.demandName ||
    row.contractName ||
    row.productName ||
    '历史记录'
  );
}

function buildDuplicateCriterion({ currentDate, candidates, duplicateMatches, olderSimilarMatches }) {
  if (duplicateMatches.length > 0) {
    const top = duplicateMatches[0];
    return {
      triggered: true,
      determinate: true,
      reason: `程序匹配到 ${duplicateMatches.length} 项 365 天内的同类历史采购；最相似为「${rowTitle(top.row)}」（${top.historicalDate}），距本次采购 ${Math.round(top.daysApart)} 天。`
    };
  }

  if (!candidates.length) {
    return {
      triggered: false,
      determinate: true,
      reason: '程序未发现明显同类历史采购，无一年内重复风险线索。'
    };
  }

  if (!currentDate) {
    return {
      triggered: false,
      determinate: false,
      reason: '本次采购缺少可解析的审批/方案日期，程序无法按日期判定一年内重复风险，请人工确认。'
    };
  }

  const datedCandidate = olderSimilarMatches.find((candidate) => candidate.daysApart !== null) || null;
  if (datedCandidate) {
    return {
      triggered: false,
      determinate: true,
      reason: `最相似的历史采购「${rowTitle(datedCandidate.row)}」（${datedCandidate.historicalDate}）距本次采购 ${Math.round(datedCandidate.daysApart)} 天，超过 365 天，未触发一年内重复采购风险。`
    };
  }

  const undatedCandidate = candidates[0];
  return {
    triggered: false,
    determinate: false,
    reason: `最相似的历史采购「${rowTitle(undatedCandidate.row)}」缺少可解析日期，程序无法按日期判定一年内重复风险，请人工确认。`
  };
}

function buildAmountIncreaseCriterion(trend) {
  if (!trend) {
    return {
      triggered: false,
      determinate: false,
      reason: '程序未识别到可比的同类历史金额。'
    };
  }
  return {
    triggered: trend.direction === '上涨',
    determinate: true,
    reason: trend.message
  };
}

function buildAgencyCriterion({ agencyReminders, candidates }) {
  if (agencyReminders.length > 0) {
    const list = agencyReminders
      .slice(0, 3)
      .map((item) => `${item.agencyName}/${item.agencyPerson}`)
      .join('、');
    return {
      triggered: true,
      determinate: true,
      reason: `历史同类采购曾由 ${list} 代理。`
    };
  }
  if (!candidates.length) {
    return {
      triggered: false,
      determinate: true,
      reason: '程序未发现明显同类历史采购，无代理机构/人员提醒。'
    };
  }
  return {
    triggered: false,
    determinate: true,
    reason: '匹配的历史采购未提供代理机构/人员信息。'
  };
}

function analyzeProcurements(currentRows, historyRows) {
  const rows = currentRows.map((current) => {
    const currentDate = rowDate(current);
    const candidates = historyRows
      .map((historical) => {
        const similarity = compareRows(current, historical);
        const historicalDate = rowDate(historical);
        return {
          ...similarity,
          row: historical,
          currentDate: currentDate ? currentDate.toISOString().slice(0, 10) : '',
          historicalDate: historicalDate ? historicalDate.toISOString().slice(0, 10) : '',
          daysApart: daysBetween(currentDate, historicalDate)
        };
      })
      .filter(isCandidate)
      .sort((left, right) => right.score - left.score)
      .slice(0, 10);

    const duplicateMatches = candidates
      .filter((candidate) => candidate.daysApart !== null && candidate.daysApart <= 365)
      .slice(0, 5);
    const olderSimilarMatches = candidates
      .filter((candidate) => candidate.daysApart === null || candidate.daysApart > 365)
      .slice(0, 6);
    const trend = summarizeTrend(current, olderSimilarMatches.length ? olderSimilarMatches : candidates);
    const agencyReminders = summarizeAgency(candidates);
    const programRisk = programRiskForRow({ duplicateMatches, candidates, trend, agencyReminders });

    const criteria = {
      duplicateWithinOneYear: buildDuplicateCriterion({
        currentDate,
        candidates,
        duplicateMatches,
        olderSimilarMatches
      }),
      amountIncrease: buildAmountIncreaseCriterion(trend),
      agencyReminder: buildAgencyCriterion({ agencyReminders, candidates })
    };

    const flags = [];
    if (criteria.duplicateWithinOneYear.triggered) flags.push('一年内疑似重复采购');
    if (criteria.amountIncrease.triggered) flags.push('同类历史金额上涨');
    if (criteria.agencyReminder.triggered) flags.push('历史代理机构/人员提醒');
    if (!candidates.length) flags.push('未发现明显同类历史');

    const referenceDate = {
      current: currentDate ? currentDate.toISOString().slice(0, 10) : null,
      currentLabel: currentDate ? currentDate.toISOString().slice(0, 10) : '未识别'
    };

    return {
      current,
      flags,
      programRisk,
      candidateCount: candidates.length,
      duplicateMatches,
      olderSimilarMatches,
      topMatches: candidates.slice(0, 5),
      trend,
      agencyReminders,
      referenceDate,
      criteria
    };
  });

  const rowRisks = rows.map((row) => row.programRisk);
  const maxRisk = rowRisks.length ? Math.max(...rowRisks) : 0;
  const avgRisk = rowRisks.length
    ? rowRisks.reduce((sum, risk) => sum + risk, 0) / rowRisks.length
    : 0;
  const programRisk = Math.round(maxRisk * 0.7 + avgRisk * 0.3);

  return {
    programRisk,
    rows,
    totals: {
      uploadedRows: currentRows.length,
      historyRows: historyRows.length,
      rowsWithDuplicateRisk: rows.filter((row) => row.duplicateMatches.length).length,
      rowsWithAmountIncrease: rows.filter((row) => row.trend?.direction === '上涨').length,
      rowsWithAgencyReminder: rows.filter((row) => row.agencyReminders.length).length
    }
  };
}

module.exports = {
  analyzeProcurements,
  cleanText,
  compareRows,
  diceCoefficient,
  durationYears,
  numericAmount,
  parseProcurementDate,
  rowAmount,
  rowDate
};
