import { getFinancialSummary, getDailyBreakdown, closeDay, getDayClosings, getTodayExpected } from '../services/financial.js';
import { showToast } from '../components/toast.js';
import { fmtKES, today, dateRangeFor } from '../utils.js';

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[char]);
}

function diffClass(value) {
  if (Math.abs(Number(value) || 0) < 0.005) return 'diff-zero';
  return Number(value) < 0 ? 'diff-negative' : 'diff-positive';
}

function dateTime(value) {
  return value ? escapeHtml(String(value).replace('T', ' ').slice(0, 16)) : '—';
}

export async function renderFinancial() {
  const app = document.getElementById('app');
  let period = 'today';
  let customFrom = today();
  let customTo = today();
  let summary = { revenue: 0, cogs: 0, profit: 0, outstandingCredit: 0, error: null };
  let daily = [];
  let closings = [];
  let todaySummary = { revenue: 0, cogs: 0, profit: 0, error: null };
  let expected = { expectedCash: 0, expectedMpesa: 0 };
  let closingError = null;

  app.innerHTML = '<p>Loading...</p>';

  async function loadPage() {
    const range = period === 'custom' ? { from: customFrom, to: customTo } : dateRangeFor(period);
    const [summaryResult, dailyResult, closingsResult] = await Promise.all([
      getFinancialSummary(range.from, range.to),
      getDailyBreakdown(range.from, range.to),
      getDayClosings(),
    ]);
    summary = summaryResult;
    daily = dailyResult ?? [];
    closingError = closingsResult.error;
    closings = closingsResult.data ?? [];

    const alreadyClosed = closings.some((closing) => closing.closing_date === today());
    if (!alreadyClosed) {
      const [todaySummaryResult, expectedResult] = await Promise.all([
        getFinancialSummary(today(), today()),
        getTodayExpected(),
      ]);
      todaySummary = todaySummaryResult;
      expected = expectedResult;
    }
    renderPage();
  }

  function renderChart() {
    if (!daily.length) return '<p>No daily data for this period.</p>';
    const maxRevenue = Math.max(...daily.map((bucket) => Number(bucket.revenue || 0)), 0);
    return `<div class="financial-chart-scroll"><div class="financial-chart">
      ${daily.map((bucket) => {
        const revenueHeight = maxRevenue ? Math.max(Number(bucket.revenue || 0), 0) / maxRevenue * 100 : 0;
        const profitHeight = maxRevenue ? Math.max(Number(bucket.profit || 0), 0) / maxRevenue * 100 : 0;
        return `<div class="financial-chart-bucket">
          <div class="financial-chart-bars">
            <div class="financial-chart-bar revenue-bar" style="height:${revenueHeight}%" title="Revenue ${fmtKES(bucket.revenue)}"></div>
            <div class="financial-chart-bar profit-bar" style="height:${profitHeight}%" title="Profit ${fmtKES(bucket.profit)}"></div>
          </div>
          <span>${escapeHtml(bucket.date)}</span>
        </div>`;
      }).join('')}
    </div></div><div class="financial-chart-legend"><span><i class="revenue-key"></i> Revenue</span><span><i class="profit-key"></i> Profit</span></div>`;
  }

  function renderClosingHistory() {
    if (closingError) return '<p class="error">Failed to load closing history.</p>';
    if (!closings.length) return '<p>No closing history yet.</p>';
    const rows = closings.map((closing) => `<tr>
      <td>${escapeHtml(closing.closing_date)}</td>
      <td>${fmtKES(closing.expected_cash)}</td>
      <td>${fmtKES(closing.actual_cash)}</td>
      <td class="${diffClass(closing.diff_cash)}">${fmtKES(closing.diff_cash)}</td>
      <td>${fmtKES(closing.expected_mpesa)}</td>
      <td>${fmtKES(closing.actual_mpesa)}</td>
      <td class="${diffClass(closing.diff_mpesa)}">${fmtKES(closing.diff_mpesa)}</td>
      <td>${dateTime(closing.closed_at)}</td>
    </tr>`).join('');
    return `<div class="table-scroll"><table class="data-table"><thead><tr><th>Date</th><th>Exp Cash</th><th>Act Cash</th><th>Cash Diff</th><th>Exp M-Pesa</th><th>Act M-Pesa</th><th>MPesa Diff</th><th>Closed At</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  }

  function renderPage() {
    const closedToday = closings.find((closing) => closing.closing_date === today());
    const periodButtons = [
      ['today', 'Today'], ['this_week', 'This Week'], ['last_week', 'Last Week'],
      ['this_month', 'This Month'], ['3_months', '3 Months'], ['1_year', '1 Year'], ['custom', 'Custom'],
    ].map(([key, label]) => `<button type="button" class="btn ${period === key ? 'btn-green' : 'btn-ghost'}" data-period="${key}">${label}</button>`).join('');

    const closingContent = closedToday
      ? `<div class="day-closed-state"><h3>✓ Day closed at ${dateTime(closedToday.closed_at)}</h3></div>`
      : `<div class="day-closing-summary">
          <h3>Today's Summary</h3>
          <p>Today's Sales: ${fmtKES(todaySummary.revenue)}</p>
          <p>COGS: ${fmtKES(todaySummary.cogs)}</p>
          <p>Profit: ${fmtKES(todaySummary.profit)}</p>
          <p>Expected Cash: ${fmtKES(expected.expectedCash)}</p>
          <p>Expected M-Pesa: ${fmtKES(expected.expectedMpesa)}</p>
        </div>
        <div class="day-closing-inputs">
          <label>Actual Cash on Hand<input id="actual-cash" type="number" min="0" step="0.01"></label>
          <label>Actual M-Pesa Balance<input id="actual-mpesa" type="number" min="0" step="0.01"></label>
        </div>
        <div id="closing-differences" class="closing-differences hidden"></div>
        <p id="closing-error" class="error hidden" role="alert"></p>
        <div class="action-bar"><button id="close-day-button" class="btn btn-green" type="button">Close for the Day</button></div>`;

    app.innerHTML = `
      <div class="financial-titlebar"><h1>Financial</h1>
      <div class="financial-filter-bar">${periodButtons}
        ${period === 'custom' ? `<label>From<input id="financial-from" type="date" value="${escapeHtml(customFrom)}"></label><label>To<input id="financial-to" type="date" value="${escapeHtml(customTo)}"></label>` : ''}
      </div></div>
      ${summary.error ? '<p class="error">Failed to load financial summary.</p>' : ''}
      <section class="financial-kpis">
        <article class="card"><h2>Total Revenue</h2><p>${fmtKES(summary.revenue)}</p></article>
        <article class="card"><h2>COGS</h2><p>${fmtKES(summary.cogs)}</p></article>
        <article class="card"><h2>Net Profit</h2><p>${fmtKES(summary.profit)}</p></article>
        <article class="card"><h2>Outstanding Credit</h2><p>${fmtKES(summary.outstandingCredit)}</p></article>
      </section>
      <section class="card financial-chart-card"><h2>Daily Revenue and Profit</h2>${renderChart()}</section>
      <section class="card day-closing-section">
        <h2>Close the Day — ${today()}</h2>
        ${closingContent}
      </section>
      <section class="closing-history-section"><h2>Closing History</h2>${renderClosingHistory()}</section>`;

    app.querySelectorAll('[data-period]').forEach((button) => button.addEventListener('click', () => {
      period = button.dataset.period;
      if (period === 'custom') {
        customFrom = today();
        customTo = today();
      }
      app.innerHTML = '<p>Loading...</p>';
      loadPage();
    }));

    const fromInput = document.getElementById('financial-from');
    const toInput = document.getElementById('financial-to');
    if (fromInput) fromInput.addEventListener('change', () => {
      customFrom = fromInput.value;
      if (customFrom && customTo) { app.innerHTML = '<p>Loading...</p>'; loadPage(); }
    });
    if (toInput) toInput.addEventListener('change', () => {
      customTo = toInput.value;
      if (customFrom && customTo) { app.innerHTML = '<p>Loading...</p>'; loadPage(); }
    });

    if (!closedToday) bindDayClosing();
  }

  function bindDayClosing() {
    const cashInput = document.getElementById('actual-cash');
    const mpesaInput = document.getElementById('actual-mpesa');
    const differences = document.getElementById('closing-differences');
    const closeButton = document.getElementById('close-day-button');

    function updateDifferences() {
      if (cashInput.value === '' || mpesaInput.value === '') {
        differences.classList.add('hidden');
        differences.innerHTML = '';
        return null;
      }
      const actualCash = Number(cashInput.value);
      const actualMpesa = Number(mpesaInput.value);
      const cashDiff = Number((actualCash - Number(expected.expectedCash || 0)).toFixed(2));
      const mpesaDiff = Number((actualMpesa - Number(expected.expectedMpesa || 0)).toFixed(2));
      differences.innerHTML = `<div class="closing-diff-row"><strong>Cash</strong><span>Expected ${fmtKES(expected.expectedCash)}</span><span>Actual ${fmtKES(actualCash)}</span><span class="${diffClass(cashDiff)}">Diff ${fmtKES(cashDiff)}</span></div>
        <div class="closing-diff-row"><strong>M-Pesa</strong><span>Expected ${fmtKES(expected.expectedMpesa)}</span><span>Actual ${fmtKES(actualMpesa)}</span><span class="${diffClass(mpesaDiff)}">Diff ${fmtKES(mpesaDiff)}</span></div>`;
      differences.classList.remove('hidden');
      return { actualCash, actualMpesa, cashDiff, mpesaDiff };
    }

    cashInput.addEventListener('input', updateDifferences);
    mpesaInput.addEventListener('input', updateDifferences);
    closeButton.addEventListener('click', async () => {
      const errorMessage = document.getElementById('closing-error');
      errorMessage.textContent = '';
      errorMessage.classList.add('hidden');
      if (cashInput.value === '' || mpesaInput.value === '') {
        errorMessage.textContent = 'Enter both actual balances before closing the day.';
        errorMessage.classList.remove('hidden');
        return;
      }
      const amounts = updateDifferences();
      if (amounts.cashDiff !== 0 || amounts.mpesaDiff !== 0) {
        if (!window.confirm('Differences detected. Close the day anyway?')) return;
      }
      closeButton.disabled = true;
      closeButton.textContent = 'Closing...';
      const { error } = await closeDay(today(), amounts.actualCash, amounts.actualMpesa);
      if (error) {
        if (error.message === 'Day already closed') showToast('Day was already closed', 'error');
        else showToast(error.message || 'Failed to close the day', 'error');
        closeButton.disabled = false;
        closeButton.textContent = 'Close for the Day';
        return;
      }
      showToast('Day closed successfully');
      renderFinancial();
    });
  }

  await loadPage();
}
