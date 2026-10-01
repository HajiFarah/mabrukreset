import { getSupplierWithReceipts } from '../services/suppliers.js';
import { fmtKES } from '../utils.js';

function escapeHtml(v) {
  return String(v ?? '').replace(/[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function fmtDate(dateStr) {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' });
}

function initial(name) {
  return escapeHtml((name || '?')[0].toUpperCase());
}

export async function renderSupplierDetail(id) {
  const app = document.getElementById('app');
  app.innerHTML = '<p>Loading…</p>';

  const result = await getSupplierWithReceipts(id);
  if (result.error) {
    app.innerHTML = `<p class="error">Failed to load supplier.</p>
      <a href="#/suppliers" class="btn btn-ghost">← Back to Suppliers</a>`;
    return;
  }

  const { supplier, receipts = [] } = result;
  const totalPurchased = receipts.reduce((s, r) => s + Number(r.total_cost || 0), 0);
  const receiptCount = receipts.length;

  const receiptCards = receipts.map((receipt) => {
    const products = Array.isArray(receipt.products) ? receipt.products : [];
    const rows = products.length
      ? products.map((p) => {
          const size = [p.size_value, p.size_unit].filter((v) => v !== null && v !== '').join(' ');
          const lineTotal = Number(p.cost_price || 0) * Number(p.stock_qty || 0);
          return `<tr>
            <td>${escapeHtml(p.name)}</td>
            <td>${escapeHtml(p.category || '—')}</td>
            <td>${escapeHtml(size || '—')}</td>
            <td>${escapeHtml(String(p.stock_qty ?? '—'))}</td>
            <td>${fmtKES(p.cost_price)}</td>
            <td>${fmtKES(lineTotal)}</td>
          </tr>`;
        }).join('')
      : '<tr><td colspan="6" class="td-muted">No products on this receipt.</td></tr>';

    return `<article class="sup-receipt-card">
      <div class="sup-receipt-header">
        <div>
          <strong>${fmtDate(receipt.receipt_date)}</strong>
          ${receipt.note ? `<span class="sup-receipt-note">${escapeHtml(receipt.note)}</span>` : ''}
        </div>
        <span class="badge badge-green">${fmtKES(receipt.total_cost)}</span>
      </div>
      <div class="table-scroll">
        <table class="data-table">
          <thead><tr><th>Product</th><th>Type</th><th>Size</th><th>Qty</th><th>Unit cost</th><th>Total</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </article>`;
  }).join('');

  app.innerHTML = `
    <div class="sup-detail-page">
      <a href="#/suppliers" class="sup-back">← All Suppliers</a>

      <div class="sup-header-card card">
        <div class="sup-header-top">
          <div class="supplier-avatar">${initial(supplier.name)}</div>
          <div>
            <h1>${escapeHtml(supplier.name)}</h1>
            ${supplier.phone ? `<p class="sup-phone">${escapeHtml(supplier.phone)}</p>` : ''}
          </div>
        </div>
        <div class="sup-header-stats">
          <div class="kpi-card">
            <span class="kpi-label">Receipts</span>
            <span class="kpi-value">${receiptCount}</span>
          </div>
          <div class="kpi-card">
            <span class="kpi-label">Total purchased</span>
            <span class="kpi-value">${fmtKES(totalPurchased)}</span>
          </div>
        </div>
      </div>

      <div class="sup-receipts">
        <h2>Receipts</h2>
        ${receipts.length ? receiptCards : '<p class="muted">No receipts recorded yet.</p>'}
      </div>
    </div>`;
}
