import { getCredits, getCreditPayments, settleCredit } from '../services/credits.js';
import { refreshBanner } from '../components/banner.js';
import { openModal, closeModal } from '../components/modal.js';
import { showToast } from '../components/toast.js';
import { fmtKES } from '../utils.js';

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[char]);
}

function displayDate(value) {
  return value ? escapeHtml(String(value).slice(0, 10)) : '—';
}

export async function renderCredits() {
  const app = document.getElementById('app');
  app.innerHTML = '<p>Loading...</p>';

  const { data, error } = await getCredits();
  if (error) {
    app.innerHTML = '<p class="error">Failed to load credits.</p>';
    return;
  }

  const credits = data ?? [];
  const pending = credits.filter((sale) => sale.status === 'credit');
  const outstanding = pending.reduce((sum, sale) => sum + Number(sale.balance || 0), 0);
  const rows = credits.length ? credits.map((sale) => {
    const paid = Math.max(Number(sale.total || 0) - Number(sale.balance || 0), 0);
    const status = sale.status === 'settled'
      ? '<span class="badge badge-green">Settled</span>'
      : '<span class="badge badge-pending">Pending</span>';
    return `<tr>
      <td>${escapeHtml(sale.client_name || '—')}</td>
      <td>${escapeHtml(sale.client_phone || '—')}</td>
      <td>${displayDate(sale.created_at)}</td>
      <td>${fmtKES(sale.total)}</td>
      <td>${fmtKES(paid)}</td>
      <td>${fmtKES(sale.balance)}</td>
      <td>${status}</td>
      <td class="credit-actions">
        ${sale.status === 'credit' ? `<button type="button" class="btn btn-green" data-action="settle" data-id="${escapeHtml(sale.id)}">Settle</button>` : ''}
        <button type="button" class="btn btn-ghost" data-action="view" data-id="${escapeHtml(sale.id)}">View</button>
      </td>
    </tr>`;
  }).join('') : '<tr><td colspan="8">No credit sales found.</td></tr>';

  app.innerHTML = `
    <h1>Credits</h1>
    <section class="card credit-kpi"><h2>Total outstanding: ${fmtKES(outstanding)} across ${pending.length} clients</h2></section>
    <div class="table-scroll"><table class="data-table">
      <thead><tr><th>Client</th><th>Phone</th><th>Date</th><th>Sale Total</th><th>Paid</th><th>Balance</th><th>Status</th><th>Actions</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>`;

  const overlay = document.getElementById('modal-overlay');
  if (!overlay.dataset.creditsCloseBound) {
    overlay.addEventListener('click', (event) => {
      if (event.target.closest('[data-modal-close]')) closeModal();
    });
    overlay.dataset.creditsCloseBound = 'true';
  }

  app.querySelectorAll('[data-action="view"]').forEach((button) => {
    button.addEventListener('click', async () => {
      const sale = credits.find((item) => item.id === button.dataset.id);
      if (!sale) return;
      const { data: payments, error: paymentError } = await getCreditPayments(sale.id);
      if (paymentError) {
        showToast(paymentError.message || 'Failed to load payment history', 'error');
        return;
      }

      const paymentRows = (payments ?? []).map((payment) => `<tr>
        <td>${displayDate(payment.created_at)}</td>
        <td>${fmtKES(payment.amount)}</td>
        <td>${escapeHtml(payment.method)}</td>
      </tr>`).join('');
      const paid = Math.max(Number(sale.total || 0) - Number(sale.balance || 0), 0);
      openModal(`<section class="credit-detail-modal">
        <h2>${escapeHtml(sale.client_name || 'Client')}</h2>
        <p>Date: ${displayDate(sale.created_at)}</p>
        <p>Sale total: ${fmtKES(sale.total)}</p>
        <p>Amount paid so far: ${fmtKES(paid)}</p>
        <p>Balance: ${fmtKES(sale.balance)}</p>
        <h3>Payment History</h3>
        ${paymentRows.length ? `<div class="table-scroll"><table class="data-table"><thead><tr><th>Date</th><th>Amount</th><th>Method</th></tr></thead><tbody>${paymentRows}</tbody></table></div>` : '<p>No payments recorded yet.</p>'}
        <div class="modal-actions"><button type="button" class="btn btn-ghost" data-modal-close>Close</button></div>
      </section>`);
    });
  });

  app.querySelectorAll('[data-action="settle"]').forEach((button) => {
    button.addEventListener('click', () => {
      const sale = credits.find((item) => item.id === button.dataset.id);
      if (!sale) return;
      let method = 'cash';
      openModal(`<form id="settle-credit-form" class="settle-credit-form">
        <h2>Settle Credit — ${escapeHtml(sale.client_name || 'Client')}</h2>
        <p>Outstanding: ${fmtKES(sale.balance)}</p>
        <label>Amount<input name="amount" type="number" min="1" step="0.01" value="${escapeHtml(sale.balance)}" required></label>
        <fieldset><legend>Payment method</legend>
          <button type="button" class="btn btn-green" data-method="cash">Cash</button>
          <button type="button" class="btn btn-ghost" data-method="mpesa">M-Pesa</button>
        </fieldset>
        <div class="modal-actions"><button class="btn btn-green" type="submit">Record Payment</button><button class="btn btn-ghost" type="button" data-modal-close>Cancel</button></div>
      </form>`);

      const form = document.getElementById('settle-credit-form');
      form.querySelectorAll('[data-method]').forEach((methodButton) => {
        methodButton.addEventListener('click', () => {
          method = methodButton.dataset.method;
          form.querySelectorAll('[data-method]').forEach((item) => {
            item.classList.toggle('btn-green', item.dataset.method === method);
            item.classList.toggle('btn-ghost', item.dataset.method !== method);
          });
        });
      });
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const submitButton = form.querySelector('[type="submit"]');
        const amount = Number(form.elements.amount.value);
        if (!Number.isFinite(amount) || amount < 1) {
          showToast('Enter a payment amount of at least 1', 'error');
          return;
        }
        submitButton.disabled = true;
        submitButton.textContent = 'Recording...';
        const { error: settleError } = await settleCredit(sale.id, amount, method);
        if (settleError) {
          showToast(settleError.message || 'Failed to record payment', 'error');
          submitButton.disabled = false;
          submitButton.textContent = 'Record Payment';
          return;
        }

        showToast(`Payment of ${fmtKES(amount)} recorded`);
        await refreshBanner();
        closeModal();
        renderCredits();
      });
    });
  });
}
