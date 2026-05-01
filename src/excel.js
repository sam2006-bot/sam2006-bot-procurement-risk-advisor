const fs = require('fs');
const path = require('path');
const JSZip = require('jszip');
const { XMLParser } = require('fast-xml-parser');

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  trimValues: false,
  parseTagValue: false,
  parseAttributeValue: false
});

const FIELD_ALIASES = {
  demandName: ['需求名称', '需求申请名称'],
  department: ['需求部门名称', '需求部门', '部门名称'],
  applicant: ['需求申请人名称', '需求申请人', '申请人'],
  approvalTime: ['需求审批完成时间', '需求审批时间', '审批完成时间'],
  catalog: ['产品目录', '目录'],
  projectName: ['采购项目名称', '项目名称'],
  projectTime: ['采购方案创建时间', '方案创建时间', '采购创建时间'],
  projectCreator: ['采购方案创建人名称', '采购方案创建人', '创建人'],
  method: ['采购方式名称', '采购方式'],
  organization: ['组织形式名称', '组织形式'],
  agencyName: ['代理项目名称', '代理机构名称', '代理机构', '采购代理机构'],
  agencyPerson: ['代理机构负责人名称', '代理机构负责人', '代理机构人员', '代理人员', '项目负责人'],
  contractNo: ['合同正式编号', '合同编号'],
  contractName: ['合同名称'],
  supplier: ['供应商名称', '供应商'],
  productCode: ['产品编码', '物料编码'],
  productName: ['产品名称', '物料名称'],
  demandAmount: ['需求合计总金额', '需求总金额', '预算金额', '需求金额'],
  demandQuantity: ['需求数量', '数量'],
  resultAmountNoTax: ['采购结果不含税总金额', '不含税总金额', '采购结果不含税金额'],
  resultAmountTax: ['采购结果含税金额', '含税金额', '采购结果含税总金额']
};

const REQUIRED_SCORE_FIELDS = [
  'demandName',
  'approvalTime',
  'catalog',
  'projectName',
  'agencyName',
  'agencyPerson',
  'contractName',
  'productCode',
  'productName',
  'demandAmount'
];

function normalizeHeader(value) {
  return String(value || '')
    .replace(/\s+/g, '')
    .replace(/[()（）]/g, '')
    .trim();
}

function resolveHeaderMap(headerRow) {
  const normalized = Array.from({ length: headerRow.length }, (_, index) => normalizeHeader(headerRow[index]));
  const map = {};

  for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
    const aliasSet = aliases.map(normalizeHeader);
    let index = normalized.findIndex((header) => aliasSet.includes(header));

    if (index === -1) {
      index = normalized.findIndex((header) =>
        aliasSet.some((alias) => alias && (header.includes(alias) || alias.includes(header)))
      );
    }

    if (index !== -1) {
      map[field] = index;
    }
  }

  return map;
}

function scoreHeaderMap(map) {
  return REQUIRED_SCORE_FIELDS.reduce((score, field) => score + (field in map ? 1 : 0), 0);
}

function asArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function textFromNode(node) {
  if (node === undefined || node === null) return '';
  if (typeof node === 'string' || typeof node === 'number' || typeof node === 'boolean') {
    return String(node);
  }
  if (typeof node === 'object') {
    if (node['#text'] !== undefined) return String(node['#text']);
    return Object.values(node).map(textFromNode).join('');
  }
  return '';
}

function textFromSharedString(si) {
  if (!si) return '';
  if (si.t !== undefined) return textFromNode(si.t);
  if (si.r !== undefined) {
    return asArray(si.r)
      .map((run) => textFromNode(run.t))
      .join('');
  }
  return textFromNode(si);
}

function columnIndexFromRef(ref) {
  const letters = String(ref || '').match(/[A-Z]+/i)?.[0];
  if (!letters) return 0;

  let index = 0;
  for (const letter of letters.toUpperCase()) {
    index = index * 26 + letter.charCodeAt(0) - 64;
  }
  return index - 1;
}

function resolveWorkbookTarget(target) {
  const normalized = String(target || '').replace(/^\/+/, '');
  if (normalized.startsWith('xl/')) return normalized;
  return path.posix.normalize(path.posix.join('xl', normalized));
}

async function zipText(zip, fileName) {
  const file = zip.file(fileName);
  return file ? file.async('string') : null;
}

async function readSharedStrings(zip) {
  const xml = await zipText(zip, 'xl/sharedStrings.xml');
  if (!xml) return [];

  const parsed = xmlParser.parse(xml);
  return asArray(parsed.sst?.si).map(textFromSharedString);
}

function cellValue(cell, sharedStrings) {
  const type = cell?.['@_t'];
  const raw = textFromNode(cell?.v);

  if (type === 's') {
    return sharedStrings[Number(raw)] || '';
  }

  if (type === 'inlineStr') {
    return textFromSharedString(cell.is);
  }

  if (type === 'b') {
    return raw === '1' ? 'TRUE' : 'FALSE';
  }

  return raw;
}

async function readSheetRows(zip, target, sharedStrings) {
  const xml = await zipText(zip, target);
  if (!xml) return [];

  const parsed = xmlParser.parse(xml);
  const rowNodes = asArray(parsed.worksheet?.sheetData?.row);
  const rows = [];

  for (const rowNode of rowNodes) {
    const rowNumber = Number(rowNode['@_r']) || rows.length + 1;
    const row = [];

    for (const cell of asArray(rowNode.c)) {
      const index = columnIndexFromRef(cell['@_r']);
      row[index] = cellValue(cell, sharedStrings);
    }

    rows[rowNumber - 1] = row;
  }

  return rows;
}

async function readWorkbookSheets(buffer) {
  let zip;
  try {
    zip = await JSZip.loadAsync(buffer);
  } catch {
    throw new Error('无法读取 Excel 文件，请上传 .xlsx 格式文件。');
  }

  const workbookXml = await zipText(zip, 'xl/workbook.xml');
  const relsXml = await zipText(zip, 'xl/_rels/workbook.xml.rels');
  if (!workbookXml || !relsXml) {
    throw new Error('Excel 工作簿结构不完整，请确认文件未损坏。');
  }

  const workbook = xmlParser.parse(workbookXml);
  const rels = xmlParser.parse(relsXml);
  const relMap = new Map(
    asArray(rels.Relationships?.Relationship).map((relationship) => [
      relationship['@_Id'],
      resolveWorkbookTarget(relationship['@_Target'])
    ])
  );
  const sharedStrings = await readSharedStrings(zip);
  const sheets = [];

  for (const sheet of asArray(workbook.workbook?.sheets?.sheet)) {
    const rid = sheet['@_r:id'];
    const target = relMap.get(rid);
    if (!target) continue;

    sheets.push({
      sheetName: sheet['@_name'] || `Sheet${sheets.length + 1}`,
      rows: await readSheetRows(zip, target, sharedStrings)
    });
  }

  return sheets;
}

function findBestSheet(workbookSheets) {
  let best = null;

  for (const { sheetName, rows } of workbookSheets) {
    for (let rowIndex = 0; rowIndex < Math.min(rows.length, 12); rowIndex += 1) {
      const headerMap = resolveHeaderMap(rows[rowIndex] || []);
      const score = scoreHeaderMap(headerMap);
      const nonEmpty = (rows[rowIndex] || []).filter((cell) => String(cell || '').trim()).length;

      if (!best || score > best.score || (score === best.score && nonEmpty > best.nonEmpty)) {
        best = { sheetName, rows, headerRowIndex: rowIndex, headerMap, score, nonEmpty };
      }
    }
  }

  if (!best || best.score < 4) {
    throw new Error('未找到可识别的明细表头，请确认上传表格与参考表格式一致。');
  }

  return best;
}

function cell(row, index) {
  if (index === undefined) return '';
  const value = row[index];
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function rowToRecord(row, headerMap, sourceRowNumber, sheetName, fileName) {
  const raw = {};
  const record = {
    sourceRowNumber,
    sheetName,
    fileName
  };

  for (const [field, index] of Object.entries(headerMap)) {
    record[field] = cell(row, index);
    raw[field] = record[field];
  }

  record.displayName =
    record.projectName ||
    record.demandName ||
    record.contractName ||
    record.productName ||
    `第 ${sourceRowNumber} 行`;
  record.raw = raw;
  return record;
}

async function parseWorkbookBuffer(buffer, fileName = 'uploaded.xlsx') {
  const workbookSheets = await readWorkbookSheets(buffer);
  const best = findBestSheet(workbookSheets);
  const records = [];

  for (let i = best.headerRowIndex + 1; i < best.rows.length; i += 1) {
    const row = best.rows[i] || [];
    const hasValue = row.some((value) => String(value || '').trim());
    if (!hasValue) continue;

    records.push(rowToRecord(row, best.headerMap, i + 1, best.sheetName, fileName));
  }

  return {
    sheetName: best.sheetName,
    headerRowNumber: best.headerRowIndex + 1,
    rowCount: records.length,
    records,
    mappedFields: Object.keys(best.headerMap)
  };
}

async function loadWorkbookFile(filePath) {
  const absolutePath = path.resolve(filePath);
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`历史参考表不存在：${absolutePath}`);
  }
  return parseWorkbookBuffer(fs.readFileSync(absolutePath), path.basename(filePath));
}

module.exports = {
  FIELD_ALIASES,
  parseWorkbookBuffer,
  loadWorkbookFile
};
