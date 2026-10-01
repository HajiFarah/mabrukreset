import { getSupplierWithReceipts } from '../services/suppliers.js';
import { deleteReceipt } from '../services/products.js';
import { openModal, closeModal } from '../components/modal.js';
import { showToast } from '../components/toast.js';
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
    const items = Array.isArray(receipt.receipt_items) ? receipt.receipt_items : [];
    const rows = items.length
      ? items.map((item) => {
          const size = [item.size_value, item.size_unit].filter((v) => v !== null && v !== '').join(' ');
          const unit = item.category === 'bag' ? 'kg' : 'pcs';
          return `<tr>
            <td>${escapeHtml(item.product_name)}</td>
            <td>${escapeHtml(item.category || '—')}</td>
            <td>${escapeHtml(size || '—')}</td>
            <td>${escapeHtml(String(item.qty ?? '—'))} ${unit}</td>
            <td>${fmtKES(item.cost_price)}</td>
            <td>${fmtKES(item.line_total)}</td>
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
        <button class="btn btn-red btn-sm" type="button" data-delete-receipt="${escapeHtml(receipt.id)}">Delete receipt</button>
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

  const modalOverlay = document.getElementById('modal-overlay');
  if (modalOverlay && !modalOverlay.dataset.closeButtonsBound) {
    modalOverlay.addEventListener('click', (event) => {
      if (event.target.closest('[data-modal-close]')) closeModal();
    });
    modalOverlay.dataset.closeButtonsBound = 'true';
  }

  app.querySelectorAll('[data-delete-receipt]').forEach((button) => {
    button.addEventListener('click', () => {
      const receipt = receipts.find((item) => item.id === button.dataset.deleteReceipt);
      if (!receipt) return;
      openModal(`<div class="confirm-dialog">
        <p>Delete this receipt? The stock it added will be subtracted. Products that also have stock from other suppliers will stay.</p>
        <div class="modal-actions"><button class="btn btn-red" type="button" data-confirm-delete-supplier-receipt>Delete Receipt</button><button class="btn btn-ghost" type="button" data-modal-close>Cancel</button></div>
      </div>`);
      document.querySelector('[data-confirm-delete-supplier-receipt]').addEventListener('click', async (event) => {
        event.currentTarget.disabled = true;
        const { data, error } = await deleteReceipt(receipt.id);
        if (error) {
          if (error.message?.toLowerCase().includes('sales history')) {
            showToast('Cannot delete — product has sales history', 'error');
          } else {
            showToast(error.message || 'Failed to delete receipt', 'error');
          }
          closeModal();
          return;
        }
        const deletedCount = Number(data || 0);
        showToast(deletedCount === 0
          ? 'Receipt deleted — stock reversed'
          : `Receipt deleted — ${deletedCount} product${deletedCount === 1 ? '' : 's'} removed`);
        closeModal();
        await renderSupplierDetail(id);
      });
    });
  });
}
