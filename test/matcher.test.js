const test = require('node:test');
const assert = require('node:assert/strict');
const { decodeUploadFileName } = require('../src/filename');
const { analyzeProcurements, compareRows, durationYears } = require('../src/matcher');

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
