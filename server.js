const path = require('path');
const express = require('express');
const multer = require('multer');
const { loadWorkbookFile, parseWorkbookBuffer } = require('./src/excel');
const { decodeUploadFileName } = require('./src/filename');
const { analyzeProcurements } = require('./src/matcher');
const { analyzeWithOpenRouter, composeFinalRisk } = require('./src/openrouter');

const PORT = Number(process.env.PORT || 4173);
const DEFAULT_HISTORY_WORKBOOK = process.env.HISTORY_WORKBOOK || '无源全流程报表-安徽V2.xlsx';
const DEFAULT_MODEL = process.env.OPENROUTER_MODEL || 'openai/gpt-4.1-mini';

const app = express();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 25 * 1024 * 1024
  }
});

let historyCache = null;
let historyCachePath = null;

async function getHistory() {
  const workbookPath = path.resolve(process.cwd(), DEFAULT_HISTORY_WORKBOOK);
  if (!historyCache || historyCachePath !== workbookPath) {
    historyCache = await loadWorkbookFile(workbookPath);
    historyCachePath = workbookPath;
  }
  return historyCache;
}

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/health', async (_request, response) => {
  try {
    const history = await getHistory();
    response.json({
      ok: true,
      historyWorkbook: DEFAULT_HISTORY_WORKBOOK,
      historyRows: history.rowCount,
      historySheet: history.sheetName,
      defaultModel: DEFAULT_MODEL
    });
  } catch (error) {
    response.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

app.post('/api/analyze', upload.single('file'), async (request, response) => {
  try {
    if (!request.file) {
      response.status(400).json({ error: '请上传 Excel 文件。' });
      return;
    }

    const originalFileName = decodeUploadFileName(request.file.originalname);
    const history = await getHistory();
    const uploaded = await parseWorkbookBuffer(request.file.buffer, originalFileName);

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
        fileName: DEFAULT_HISTORY_WORKBOOK,
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

app.listen(PORT, '127.0.0.1', () => {
  console.log(`Procurement risk advisor running at http://127.0.0.1:${PORT}`);
});
