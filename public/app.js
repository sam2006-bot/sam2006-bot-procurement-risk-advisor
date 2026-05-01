const form = document.querySelector('#uploadForm');
const fileInput = document.querySelector('#fileInput');
const fileLabel = document.querySelector('#fileLabel');
const healthStatus = document.querySelector('#healthStatus');
const emptyState = document.querySelector('#emptyState');
const resultPanel = document.querySelector('#resultPanel');
const finalRisk = document.querySelector('#finalRisk');
const riskMeter = document.querySelector('#riskMeter');
const riskFormula = document.querySelector('#riskFormula');
const riskTitle = document.querySelector('#riskTitle');
const metricRow = document.querySelector('#metricRow');
const aiBox = document.querySelector('#aiBox');
const resultRows = document.querySelector('#resultRows');
const submitButton = form.querySelector('button[type="submit"]');

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function riskClass(score) {
  if (score >= 70) return 'risk-high';
  if (score >= 40) return 'risk-mid';
  return 'risk-low';
}

function setRisk(score) {
  const normalized = Math.max(0, Math.min(100, Number(score) || 0));
  finalRisk.textContent = normalized;
  riskMeter.style.setProperty('--risk', normalized);
  riskMeter.classList.remove('risk-low', 'risk-mid', 'risk-high');
  riskMeter.classList.add(riskClass(normalized));
}

function chip(text) {
  return `<span class="chip">${escapeHtml(text)}</span>`;
}

function renderMetrics(data) {
  const items = [
    `上传 ${data.uploaded.rows} 行`,
    `历史 ${data.history.rows} 行`,
    `一年内重复 ${data.totals.rowsWithDuplicateRisk} 项`,
    `金额上涨 ${data.totals.rowsWithAmountIncrease} 项`,
    `代理提醒 ${data.totals.rowsWithAgencyReminder} 项`,
    `AI 分 ${data.ai.riskScore}`
  ];
  metricRow.innerHTML = items.map(chip).join('');
}

function renderAi(data) {
  const status = data.ai.available ? 'AI 审批意见' : '本地匹配意见';
  const findings = data.ai.keyFindings || [];
  const actions = data.ai.recommendedActions || [];
  const error = data.ai.error ? `<p class="muted">调用提示：${escapeHtml(data.ai.error)}</p>` : '';

  aiBox.innerHTML = `
    <p class="eyebrow">${escapeHtml(status)}</p>
    <p>${escapeHtml(data.ai.opinion || '暂无意见。')}</p>
    ${
      findings.length
        ? `<ul class="ai-list">${findings.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`
        : ''
    }
    ${
      actions.length
        ? `<ul class="ai-list">${actions.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`
        : ''
    }
    ${error}
  `;
}

function bestMatch(row) {
  const match = row.topMatches?.[0];
  if (!match) return '<span class="muted">未发现明显同类历史</span>';

  const title = match.row.projectName || match.row.demandName || match.row.contractName || '历史记录';
  const date = match.historicalDate || match.row.approvalTime || '';
  const score = Math.round(match.score * 100);
  return `
    <strong>${escapeHtml(title)}</strong>
    <span class="muted">${escapeHtml(date)} · 相似度 ${score}%</span>
  `;
}

function trendText(row) {
  if (!row.trend) return '<span class="muted">无可比金额</span>';
  const cls = row.trend.direction === '上涨' ? 'risk-mid' : row.trend.direction === '下降' ? 'risk-low' : '';
  const duration = row.trend.sameDuration
    ? `同期间：${row.trend.currentDuration.label}`
    : '已忽略年份/期间影响';
  return `
    <strong class="${cls}">${escapeHtml(row.trend.direction)}</strong>
    <span>${escapeHtml(row.trend.message)}</span>
    <br />
    <span class="muted">${escapeHtml(duration)}</span>
  `;
}

function agencyText(row) {
  if (!row.agencyReminders?.length) return '<span class="muted">无历史代理信息</span>';
  return row.agencyReminders
    .slice(0, 2)
    .map(
      (item) => `
        <strong>${escapeHtml(item.agencyName)}</strong>
        <span class="muted">${escapeHtml(item.agencyPerson)} · ${escapeHtml(item.historicalDate || '')}</span>
      `
    )
    .join('<br />');
}

function renderRows(rows) {
  resultRows.innerHTML = rows
    .map((row) => {
      const current = row.current;
      const title = current.projectName || current.demandName || current.contractName || current.displayName;
      return `
        <tr>
          <td>
            <strong>${escapeHtml(title)}</strong>
            <span class="muted">${escapeHtml(current.department || '')}</span>
          </td>
          <td>
            <strong class="${riskClass(row.programRisk)}">${row.programRisk}</strong>
            <span class="muted">程序分</span>
          </td>
          <td>
            <div class="row-chips">${(row.flags || []).map(chip).join('')}</div>
          </td>
          <td>${bestMatch(row)}</td>
          <td>${trendText(row)}</td>
          <td>${agencyText(row)}</td>
        </tr>
      `;
    })
    .join('');
}

async function loadHealth() {
  try {
    const response = await fetch('/api/health');
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.error || '历史库不可用');
    healthStatus.textContent = `历史库 ${data.historyRows} 行 · ${data.historySheet}`;
    document.querySelector('#modelInput').value = data.defaultModel;
  } catch (error) {
    healthStatus.textContent = error.message;
  }
}

fileInput.addEventListener('change', () => {
  fileLabel.textContent = fileInput.files[0]?.name || '选择待审批 Excel';
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!fileInput.files[0]) return;

  const formData = new FormData(form);
  submitButton.disabled = true;
  submitButton.textContent = '分析中...';

  try {
    const response = await fetch('/api/analyze', {
      method: 'POST',
      body: formData
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || '分析失败');

    emptyState.classList.add('hidden');
    resultPanel.classList.remove('hidden');
    setRisk(data.finalRisk.score);
    riskFormula.textContent = data.finalRisk.formula;
    riskTitle.textContent = `${data.uploaded.fileName} · ${data.uploaded.sheetName}`;
    renderMetrics(data);
    renderAi(data);
    renderRows(data.rows);
  } catch (error) {
    emptyState.classList.remove('hidden');
    resultPanel.classList.add('hidden');
    emptyState.innerHTML = `
      <div class="empty-copy">
        <p class="eyebrow">分析失败</p>
        <h2>${escapeHtml(error.message)}</h2>
        <p>请确认文件格式与参考表一致，或检查 OpenRouter Key 和模型名称。</p>
      </div>
    `;
  } finally {
    submitButton.disabled = false;
    submitButton.innerHTML = `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="m5 12 4 4L19 6" />
      </svg>
      开始分析
    `;
  }
});

loadHealth();
