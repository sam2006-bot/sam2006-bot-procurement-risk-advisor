const path = require('path');
const fs = require('fs');
const express = require('express');
const multer = require('multer');
const { loadWorkbookFile, parseWorkbookBuffer } = require('./src/excel');
const { decodeUploadFileName } = require('./src/filename');
const { analyzeProcurements } = require('./src/matcher');
const { analyzeWithOpenRouter, composeFinalRisk } = require('./src/openrouter');

const PORT = Number(process.env.PORT || 4173);
const HOST = process.env.HOST || (process.env.RENDER || process.env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1');
const DEFAULT_HISTORY_WORKBOOK = process.env.HISTORY_WORKBOOK || '无源全流程报表-安徽V2.xlsx';
const DEFAULT_MODEL = process.env.OPENROUTER_MODEL || 'openai/gpt-4.1-mini';

const app = express();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 25 * 1024 * 1024
  }
});

let bundledHistoryCache = null;
let bundledHistoryCachePath = null;

function historyFilePath() {
  return path.resolve(process.cwd(), DEFAULT_HISTORY_WORKBOOK);
}

async function getBundledHistory() {
  const workbookPath = path.resolve(process.cwd(), DEFAULT_HISTORY_WORKBOOK);
  if (!fs.existsSync(workbookPath)) {
    return null;
  }
  if (!bundledHistoryCache || bundledHistoryCachePath !== workbookPath) {
    bundledHistoryCache = await loadWorkbookFile(workbookPath);
    bundledHistoryCachePath = workbookPath;
  }
  return bundledHistoryCache;
}

async function getHistoryForRequest(request) {
  const uploadedHistory = request.files?.historyFile?.[0];
  if (uploadedHistory) {
    const historyFileName = decodeUploadFileName(uploadedHistory.originalname);
    const history = await parseWorkbookBuffer(uploadedHistory.buffer, historyFileName);
    return {
      source: 'uploaded',
      fileName: historyFileName,
      workbook: history
    };
  }

  const bundledHistory = await getBundledHistory();
  if (bundledHistory) {
    return {
      source: 'server',
      fileName: DEFAULT_HISTORY_WORKBOOK,
      workbook: bundledHistory
    };
  }

  throw new Error('未找到历史参考表。请上传历史参考 Excel，或在服务器配置 HISTORY_WORKBOOK。');
}

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/health', async (_request, response) => {
  try {
    const history = await getBundledHistory();
    response.json({
      ok: true,
      host: HOST,
      renderReady: true,
      historyWorkbook: DEFAULT_HISTORY_WORKBOOK,
      historyPath: historyFilePath(),
      historyAvailable: Boolean(history),
      historyRows: history?.rowCount || 0,
      historySheet: history?.sheetName || '',
      defaultModel: DEFAULT_MODEL
    });
  } catch (error) {
    response.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

app.post('/api/analyze', upload.fields([
  { name: 'file', maxCount: 1 },
  { name: 'historyFile', maxCount: 1 }
]), async (request, response) => {
  try {
    const currentFile = request.files?.file?.[0];
    if (!currentFile) {
      response.status(400).json({ error: '请上传 Excel 文件。' });
      return;
    }

    const originalFileName = decodeUploadFileName(currentFile.originalname);
    const historyInfo = await getHistoryForRequest(request);
    const history = historyInfo.workbook;
    const uploaded = await parseWorkbookBuffer(currentFile.buffer, originalFileName);

    if (!uploaded.records.length) {
      response.status(400).json({ error: '上传文件没有可分析的明细行。' });
      return;
    }

    const matchResult = analyzeProcurements(uploaded.records, history.records);
    const apiKey = request.body.apiKey || process.env.OPENROUTER_API_KEY || '';
    const model = request.body.model || DEFAULT_MODEL;
    const ai = await analyzeWithOpenRouter({ apiKey, model, matchResult });
    const finalRisk = composeFinalRisk(matchResult.programRisk, ai.riskScore, ai.available);

    response.json({
      uploaded: {
        fileName: originalFileName,
        sheetName: uploaded.sheetName,
        rows: uploaded.rowCount,
        mappedFields: uploaded.mappedFields
      },
      history: {
        source: historyInfo.source,
        fileName: historyInfo.fileName,
        sheetName: history.sheetName,
        rows: history.rowCount
      },
      model,
      programRisk: matchResult.programRisk,
      ai,
      finalRisk,
      totals: matchResult.totals,
      rows: matchResult.rows
    });
  } catch (error) {
    response.status(500).json({
      error: error.message
    });
  }
});

app.use((error, _request, response, _next) => {
  if (error instanceof multer.MulterError) {
    response.status(400).json({ error: error.message });
    return;
  }
  response.status(500).json({ error: error.message });
});

app.listen(PORT, HOST, () => {
  console.log(`Procurement risk advisor running at http://${HOST}:${PORT}`);
});
