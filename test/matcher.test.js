const test = require('node:test');
const assert = require('node:assert/strict');
const { decodeUploadFileName } = require('../src/filename');
const { analyzeProcurements, compareRows, durationYears } = require('../src/matcher');
const {
  deterministicNarrative,
  sanitizeAiOutput,
  FORBIDDEN_DURATION_PATTERNS,
  DUPLICATE_WORRY_PATTERN
} = require('../src/openrouter');

const historical = {
  demandName: '关于淮南移动2023-2024年综合楼食堂生鲜食材采购需求',
  projectName: '淮南移动2023-2024年综合楼食堂生鲜食材采购项目',
  department: '安徽公司/淮南分公司/综合部',
  approvalTime: '2023-05-09 15:30:05',
  catalog: '办公及劳保用品>生活用品>生活用品',
  productCode: '411301003',
  productName: '食品',
  demandAmount: '1000000',
  agencyName: '公诚管理咨询有限公司',
  agencyPerson: '郭栋'
};

test('similar purchases match even when years differ', () => {
  const current = {
    demandName: '关于2025年-2026年综合楼食堂生鲜食材供应商采购需求',
    projectName: '淮南移动2025-2026年综合楼食堂生鲜食材采购项目',
    department: '安徽公司/淮南分公司/综合部',
    approvalTime: '2025-04-28 09:00:00',
    catalog: '办公及劳保用品>生活用品>生活用品',
    productCode: '411301003',
    productName: '食品',
    demandAmount: '1280000'
  };

  const score = compareRows(current, historical);
  assert.ok(score.score > 0.7);
});

test('duration parser recognizes procurement year spans', () => {
  assert.equal(durationYears(historical).value, 2);
});

test('analysis flags duplicate, amount increase, and agency reminder', () => {
  const current = {
    demandName: '关于淮南移动2024年综合楼食堂生鲜食材采购需求',
    projectName: '淮南移动2024年综合楼食堂生鲜食材采购项目',
    department: '安徽公司/淮南分公司/综合部',
    approvalTime: '2024-01-20 09:00:00',
    catalog: '办公及劳保用品>生活用品>生活用品',
    productCode: '411301003',
    productName: '食品',
    demandAmount: '1200000'
  };

  const result = analyzeProcurements([current], [historical]);
  assert.equal(result.totals.rowsWithDuplicateRisk, 1);
  assert.equal(result.totals.rowsWithAgencyReminder, 1);
  assert.ok(result.programRisk >= 70);
});

test('same-duration historical purchase triggers amount increase warning outside one year', () => {
  const current = {
    demandName: '关于2025年-2026年综合楼食堂生鲜食材供应商采购需求',
    projectName: '淮南移动2025-2026年综合楼食堂生鲜食材采购项目',
    department: '安徽公司/淮南分公司/综合部',
    approvalTime: '2025-05-12 09:00:00',
    catalog: '办公及劳保用品>生活用品>生活用品',
    productCode: '411301003',
    productName: '食品',
    demandAmount: '1280000'
  };

  const result = analyzeProcurements([current], [historical]);
  assert.equal(result.totals.rowsWithDuplicateRisk, 0);
  assert.equal(result.totals.rowsWithAmountIncrease, 1);
  assert.ok(result.rows[0].flags.includes('同类历史金额上涨'));
});

test('upload file names are repaired when UTF-8 is decoded as latin1', () => {
  const fileName = '无源全流程报表-安徽V2.xlsx';
  const mojibake = Buffer.from(fileName, 'utf8').toString('latin1');

  assert.equal(decodeUploadFileName(mojibake), fileName);
  assert.equal(decodeUploadFileName(fileName), fileName);
});

test('amount trend uses the matched project nature instead of a same-duration but different project', () => {
  const current = {
    demandName: '关于淮南移动2029-2030年度华为IMS设备维保服务的采购申请',
    projectName: '淮南移动2029-2030年度华为IMS设备维保服务采购项目',
    contractName: '淮南分公司2029-2030年度华为IMS设备维保服务框架协议',
    department: '安徽公司/淮南分公司/网络部',
    approvalTime: '2026-04-01 09:00:00',
    catalog: '服务类>网络维护服务>维保服务',
    productCode: '391805001',
    productName: 'IMS网接入网设备维保服务',
    demandAmount: '702419'
  };
  const imsMaintenance = {
    projectName: '淮南移动2023-2025年度华为IMS设备维保服务采购项目',
    contractName: '淮南分公司2023-2025年度华为IMS设备维保服务框架协议',
    approvalTime: '2023-10-19 17:32:36',
    productCode: '391805001',
    productName: 'IMS网接入网设备维保服务',
    demandAmount: '602000'
  };
  const imsExpansion = {
    projectName: '中国移动安徽公司淮南分公司2024年至2025年华为IMS扩容设备采购项目',
    contractName: '淮南分公司2024年至2025年华为IMS扩容设备采购框架协议',
    approvalTime: '2024-05-10 16:17:13',
    productCode: '310901001',
    productName: 'IMS接入网设备其他配件',
    demandAmount: '547078.2'
  };

  const result = analyzeProcurements([current], [imsMaintenance, imsExpansion]);
  assert.equal(result.rows[0].topMatches[0].row.projectName, imsMaintenance.projectName);
  assert.equal(result.rows[0].trend.matchedHistorical.projectName, imsMaintenance.projectName);
  assert.equal(result.rows[0].trend.historicalAmount, 602000);
  assert.equal(result.rows[0].trend.sameDuration, false);
  assert.equal(result.rows[0].trend.direction, '上涨');
  assert.equal(result.totals.rowsWithAmountIncrease, 1);
  assert.ok(result.rows[0].flags.includes('同类历史金额上涨'));
});

test('criteria.duplicateWithinOneYear is triggered when within 365 days', () => {
  const historical = {
    projectName: '淮南移动2023年综合楼食堂生鲜食材采购项目',
    approvalTime: '2023-05-09 15:30:05',
    productCode: '411301003',
    productName: '食品',
    demandAmount: '1000000',
    agencyName: '公诚管理咨询有限公司',
    agencyPerson: '郭栋'
  };
  const current = {
    projectName: '淮南移动2024年综合楼食堂生鲜食材采购项目',
    approvalTime: '2024-01-20 09:00:00',
    productCode: '411301003',
    productName: '食品',
    demandAmount: '1200000'
  };

  const result = analyzeProcurements([current], [historical]);
  const criteria = result.rows[0].criteria;
  assert.equal(criteria.duplicateWithinOneYear.triggered, true);
  assert.equal(criteria.duplicateWithinOneYear.determinate, true);
  assert.match(criteria.duplicateWithinOneYear.reason, /365 天内/);
  assert.equal(criteria.amountIncrease.triggered, true);
  assert.equal(criteria.agencyReminder.triggered, true);
});

test('criteria reports determinate=true with no-risk reason when best match is older than one year', () => {
  const historical = {
    projectName: '淮南移动2020年综合楼食堂生鲜食材采购项目',
    approvalTime: '2020-05-09 15:30:05',
    productCode: '411301003',
    productName: '食品',
    demandAmount: '1000000'
  };
  const current = {
    projectName: '淮南移动2025年综合楼食堂生鲜食材采购项目',
    approvalTime: '2025-04-28 09:00:00',
    productCode: '411301003',
    productName: '食品',
    demandAmount: '1280000'
  };

  const result = analyzeProcurements([current], [historical]);
  const dup = result.rows[0].criteria.duplicateWithinOneYear;
  assert.equal(dup.triggered, false);
  assert.equal(dup.determinate, true);
  assert.match(dup.reason, /超过 365 天/);
});

test('criteria reports determinate=false when current procurement has no parseable date', () => {
  const historical = {
    projectName: '淮南移动2025年山南综合楼电动伸缩门采购项目',
    approvalTime: '2025-11-24 09:00:00',
    productCode: 'GATE-001',
    productName: '电动伸缩门',
    demandAmount: '40000'
  };
  const current = {
    projectName: '中国移动安徽公司淮南分公司综合楼电动伸缩门采购项目',
    productCode: 'GATE-001',
    productName: '电动伸缩门',
    demandAmount: '60000'
  };

  const result = analyzeProcurements([current], [historical]);
  const dup = result.rows[0].criteria.duplicateWithinOneYear;
  assert.equal(dup.triggered, false);
  assert.equal(dup.determinate, false);
  assert.match(dup.reason, /缺少可解析的审批\/方案日期|缺少可解析日期/);
});

test('criteria.duplicateWithinOneYear is determinate=true with empty reason path when no candidates exist', () => {
  const historical = {
    projectName: '完全无关的物流仓储采购项目',
    approvalTime: '2024-08-01 09:00:00',
    productCode: 'LOG-555',
    productName: '冷链仓储服务',
    demandAmount: '500000'
  };
  const current = {
    projectName: '客户经理工作手机采购项目',
    approvalTime: '2025-04-28 09:00:00',
    productCode: 'PHONE-001',
    productName: '手机',
    demandAmount: '120000'
  };

  const result = analyzeProcurements([current], [historical]);
  const dup = result.rows[0].criteria.duplicateWithinOneYear;
  assert.equal(dup.triggered, false);
  assert.equal(dup.determinate, true);
  assert.match(dup.reason, /未发现明显同类历史采购/);
});

test('deterministicNarrative produces consistent strings tied to triggered flags', () => {
  const matchResult = {
    programRisk: 75,
    rows: [
      {
        current: { projectName: '本次采购 A', displayName: '本次采购 A' },
        criteria: {
          duplicateWithinOneYear: {
            triggered: true,
            determinate: true,
            reason: '程序匹配到 1 项 365 天内的同类历史采购；最相似为「项目 X」（2024-12-01），距本次采购 60 天。'
          },
          amountIncrease: { triggered: true, determinate: true, reason: '同类历史金额为 ¥40,000，本次为 ¥60,000，金额上涨 50%。' },
          agencyReminder: { triggered: false, determinate: true, reason: '匹配的历史采购未提供代理机构/人员信息。' }
        }
      }
    ]
  };

  const narrative = deterministicNarrative(matchResult);
  assert.match(narrative.opinion, /一年内重复采购/);
  assert.match(narrative.opinion, /金额变化/);
  assert.equal(narrative.keyFindings.length, 2);
  assert.equal(narrative.recommendedActions.length, 2);
  assert.ok(narrative.recommendedActions.every((action) => !/保持.{0,4}代理.{0,4}独立/.test(action)));
});

test('sanitizeAiOutput strips forbidden duration phrases and false-positive duplicate recommendations', () => {
  const matchResult = {
    programRisk: 59,
    rows: [
      {
        current: { projectName: '电动伸缩门', displayName: '电动伸缩门' },
        criteria: {
          duplicateWithinOneYear: {
            triggered: false,
            determinate: true,
            reason: '最相似的历史采购「2025年山南综合楼电动伸缩门采购项目」（2025-11-24）距本次采购 489 天，超过 365 天，未触发一年内重复采购风险。'
          },
          amountIncrease: { triggered: true, determinate: true, reason: '同类历史金额 ¥40,000，本次 ¥60,000，上涨 50%。' },
          agencyReminder: { triggered: false, determinate: true, reason: '匹配的历史采购未提供代理机构/人员信息。' }
        }
      }
    ]
  };

  const aiOutput = {
    riskScore: 59,
    opinion:
      '本次采购与2025年11月24日的山南综合楼电动伸缩门采购项目高度相似，虽未触发一年内重复采购风险，但金额从40,000元上涨至60,000元。当前匹配到的历史项目日期为2025-11-24，距今已超过一年，不构成重复采购风险。',
    keyFindings: ['一年内疑似重复采购：未发现一年内重复采购记录，距今已超过一年'],
    recommendedActions: [
      '请采购部门核实本次综合楼伸缩门需求是否与2025年山南综合楼项目存在范围重叠，避免重复采购。',
      '请补充本次金额上涨50%的具体说明。',
      '请确保与历史项目代理机构保持独立性，避免长期依赖同一机构。'
    ]
  };

  const sanitized = sanitizeAiOutput(aiOutput, matchResult);
  assert.ok(!FORBIDDEN_DURATION_PATTERNS.some((pattern) => pattern.test(sanitized.opinion)));
  assert.ok(!DUPLICATE_WORRY_PATTERN.test(sanitized.opinion));
  assert.ok(
    sanitized.recommendedActions.every(
      (action) => !DUPLICATE_WORRY_PATTERN.test(action) && !/保持.{0,4}代理.{0,4}独立/.test(action)
    )
  );
  assert.ok(sanitized.issues.length > 0);
});

test('sanitizeAiOutput keeps clean AI output untouched', () => {
  const matchResult = {
    programRisk: 30,
    rows: [
      {
        current: { projectName: '采购 A', displayName: '采购 A' },
        criteria: {
          duplicateWithinOneYear: { triggered: false, determinate: true, reason: '程序未发现明显同类历史采购，无一年内重复风险线索。' },
          amountIncrease: { triggered: false, determinate: true, reason: '未识别可比金额。' },
          agencyReminder: { triggered: false, determinate: true, reason: '匹配的历史采购未提供代理机构/人员信息。' }
        }
      }
    ]
  };
  const cleanOutput = {
    riskScore: 22,
    opinion: '一年内重复采购：程序未发现明显同类历史采购，无一年内重复风险线索。 金额变化：未识别可比金额。 代理机构/人员：匹配的历史采购未提供代理机构/人员信息。',
    keyFindings: [],
    recommendedActions: []
  };
  const sanitized = sanitizeAiOutput(cleanOutput, matchResult);
  assert.equal(sanitized.issues.length, 0);
  assert.equal(sanitized.opinion, cleanOutput.opinion);
  assert.deepEqual(sanitized.keyFindings, []);
  assert.deepEqual(sanitized.recommendedActions, []);
});

test('best historical match is used for amount trend even when uploaded row lacks product fields', () => {
  const current = {
    demandName: '关于淮南分公司某供电公司客户经理工作手机采购需求的申请',
    projectName: '淮南分公司某供电公司客户经理工作手机采购项目',
    department: '安徽公司/淮南分公司/寿县分公司',
    catalog: '终端与配件>手机终端>手机',
    demandAmount: '121846.77'
  };
  const historicalPhone = {
    demandName: '关于寿县供电公司5G工作手机项目的采购需求',
    projectName: '中国移动安徽公司淮南分公司2024年至2025年寿县供电公司5G工作手机采购项目',
    contractName: '淮南分公司2024年至2025年寿县供电公司5G工作手机采购框架协议',
    department: '安徽公司/淮南分公司/寿县分公司/政企客户部',
    approvalTime: '2024-05-14 11:00:39',
    catalog: '终端与配件>手机终端>手机',
    productCode: '400413009',
    productName: '手机（非标产品）',
    demandAmount: '535244.39',
    agencyName: '公诚管理咨询有限公司',
    agencyPerson: '郭栋'
  };

  const result = analyzeProcurements([current], [historicalPhone]);
  assert.equal(result.rows[0].topMatches[0].row.projectName, historicalPhone.projectName);
  assert.equal(result.rows[0].trend.matchedHistorical.projectName, historicalPhone.projectName);
  assert.equal(result.rows[0].trend.historicalAmount, 535244.39);
  assert.equal(result.rows[0].trend.currentAmount, 121846.77);
  assert.equal(result.rows[0].trend.direction, '下降');
});
