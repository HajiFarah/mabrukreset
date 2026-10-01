import { getSuppliers } from '../services/suppliers.js';
import { db } from '../supabase.js';
import { fmtKES } from '../utils.js';

function escapeHtml(v) {
  return String(v ?? '').replace(/[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function initial(name) {
  return escapeHtml((name || '?')[0].toUpperCase());
}

function fmtDate(dateStr) {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' });
}

export async function renderSuppliers() {
  const app = document.getElementById('app');
  app.innerHTML = '<p>Loading…</p>';

  const [{ data: suppliers, error: suppErr }, { data: receipts, error: recErr }] = await Promise.all([
    getSuppliers(),
    db.from('receipts').select('supplier_id, total_cost, receipt_date'),
  ]);

  if (suppErr || recErr) {
    app.innerHTML = '<p class="error">Failed to load suppliers.</p>';
    return;
  }

  if (!suppliers?.length) {
    app.innerHTML = `<div class="page-empty">
      <p class="page-empty-title">No suppliers yet</p>
      <p class="page-empty-sub">Suppliers are added automatically when you record stock in.</p>
    </div>`;
    return;
  }

  // Aggregate receipt stats per supplier
  const statsMap = new Map();
  for (const r of receipts ?? []) {
    const s = statsMap.get(r.supplier_id) ?? { count: 0, total: 0, last: null };
    s.count += 1;
    s.total += Number(r.total_cost || 0);
    if (r.receipt_date && (!s.last || r.receipt_date > s.last)) s.last = r.receipt_date;
    statsMap.set(r.supplier_id, s);
  }

  const list = suppliers.map((sup) => ({ sup, stats: statsMap.get(sup.id) ?? { count: 0, total: 0, last: null } }))
    .sort((a, b) => b.stats.total - a.stats.total);

  const totalSpent = list.reduce((s, x) => s + x.stats.total, 0);
  const totalReceipts = list.reduce((s, x) => s + x.stats.count, 0);

  const kpis = `
    <div class="supplier-kpis">
      <div class="kpi-card">
        <span class="kpi-label">Suppliers</span>
        <span class="kpi-value">${list.length}</span>
      </div>
      <div class="kpi-card">
        <span class="kpi-label">Receipts</span>
        <span class="kpi-value">${totalReceipts}</span>
      </div>
      <div class="kpi-card">
        <span class="kpi-label">Total spent</span>
        <span class="kpi-value">${fmtKES(totalSpent)}</span>
      </div>
    </div>`;

  const cards = list.map(({ sup, stats }) => `
    <a href="#/suppliers/${encodeURIComponent(sup.id)}" class="supplier-card">
      <div class="supplier-avatar">${initial(sup.name)}</div>
      <div class="supplier-card-info">
        <strong>${escapeHtml(sup.name)}</strong>
        ${sup.phone ? `<span class="supplier-card-phone">${escapeHtml(sup.phone)}</span>` : ''}
        <span class="supplier-card-meta">
          ${stats.count} receipt${stats.count !== 1 ? 's' : ''}
          &middot; ${fmtKES(stats.total)}
          ${stats.last ? ` &middot; Last: ${fmtDate(stats.last)}` : ''}
        </span>
      </div>
      <span class="supplier-card-arrow">→</span>
    </a>`).join('');

  app.innerHTML = `
    <div class="suppliers-page">
      <h1>Suppliers</h1>
      ${kpis}
      <div class="supplier-list">${cards}</div>
    </div>`;
}
