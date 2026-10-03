import { getSales, getSaleById, processReturn, deleteSale } from '../services/sales.js';
import { settleCredit } from '../services/credits.js';
import { getProducts } from '../services/products.js';
import { openModal, closeModal } from '../components/modal.js';
import { showToast } from '../components/toast.js';
import { refreshBanner } from '../components/banner.js';
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

function dateTime(value) {
  return value ? escapeHtml(String(value).replace('T', ' ').slice(0, 16)) : '—';
}

function productSize(product) {
  return [product.size_value, product.size_unit].filter((v) => v !== null && v !== '').join(' ');
}

function saleCost(sale) {
  return (sale.sale_items ?? []).reduce((sum, item) => {
    return sum + Number(item.unit_cost || 0) * Number(item.qty || 0);
  }, 0);
}

function saleProfit(sale) {
  return (sale.sale_items ?? []).reduce((sum, item) => {
    return sum + (Number(item.unit_price || 0) - Number(item.unit_cost || 0)) * Number(item.qty || 0);
  }, 0);
}

function paymentMethod(sale) {
  const cash = Number(sale.paid_cash || 0);
  const mpesa = Number(sale.paid_mpesa || 0);
  if (cash > 0 && mpesa > 0) return '<span class="method-badge method-split">Split</span>';
  if (cash > 0) return '<span class="method-badge method-cash">Cash</span>';
  if (mpesa > 0) return '<span class="method-badge method-mpesa">M-Pesa</span>';
  return '<span class="method-badge">—</span>';
}

export async function renderHistory() {
  const app = document.getElementById('app');
  let period = 'today';
  let customFrom = today();
  let customTo = today();
  let sales = [];
  let filterRequest = 0;

  app.innerHTML = '<p>Loading...</p>';

  async function loadSales() {
    const request = ++filterRequest;
    const range = period === 'custom' ? { from: customFrom, to: customTo } : dateRangeFor(period);
    const result = await getSales(range.from, range.to);
    if (request !== filterRequest) return;
    if (result.error) {
      app.innerHTML = '<p class="error">Failed to load sales history.</p>';
      return;
    }
    sales = result.data ?? [];
    renderPage();
  }

  function renderPage() {
    const revenue = sales.reduce((sum, sale) => sum + Number(sale.total || 0), 0);
    const profit = sales.reduce((sum, sale) => sum + saleProfit(sale), 0);
    const productTotals = new Map();
    for (const sale of sales) {
      for (const item of sale.sale_items ?? []) {
        const name = item.product_name || 'Unknown product';
        const entry = productTotals.get(name) ?? { name, qty: 0 };
        entry.qty += Number(item.qty || 0);
        productTotals.set(name, entry);
      }
    }
    const topProducts = [...productTotals.values()].sort((a, b) => b.qty - a.qty).slice(0, 5);
    const maxQty = Math.max(...topProducts.map((product) => product.qty), 0);
    const chart = topProducts.length ? topProducts.map((product) => `<div class="history-chart-row">
      <span class="history-chart-label">${escapeHtml(product.name)}</span>
      <div class="history-chart-track"><div class="history-chart-bar" style="width:${maxQty ? (product.qty / maxQty * 100) : 0}%"></div></div>
      <span class="history-chart-qty">${escapeHtml(product.qty)}</span>
    </div>`).join('') : '<p>No product sales in this period.</p>';

    const rows = sales.length ? sales.map((sale) => {
      const items = sale.sale_items ?? [];
      const saleProfitAmount = saleProfit(sale);
      const saleCostAmount = saleCost(sale);
      const summary = items.length
        ? `${escapeHtml(items[0].product_name || 'Product')}${items.length > 1 ? ` and ${items.length - 1} more` : ''}`
        : '—';
      const paid = Number(sale.paid_cash || 0) + Number(sale.paid_mpesa || 0);
      const balanceAmt = Number(sale.balance || 0);
      const isCredit = sale.status === 'credit' && balanceAmt > 0;
      const balanceCell = balanceAmt < 0
        ? `<span class="badge badge-green">Change ${fmtKES(Math.abs(balanceAmt))}</span>`
        : isCredit
        ? `<span class="badge badge-red">Owes ${fmtKES(balanceAmt)}</span>`
        : fmtKES(balanceAmt);
      const tags = [
        sale.has_return ? '<span class="badge badge-amber">↩ Returned/Swapped</span>' : '',
        isCredit ? `<button type="button" class="btn btn-green btn-sm" data-action="settle" data-id="${escapeHtml(sale.id)}">Settle</button>` : '',
      ].filter(Boolean).join(' ');
      const clientCell = sale.client_name
        ? escapeHtml(sale.client_name)
        : '<span class="walkin-label">Walk-in</span>';
      return `<tr class="history-sale-row${isCredit ? ' row-credit-outstanding' : ''}" data-sale-id="${escapeHtml(sale.id)}" tabindex="0">
        <td class="cell-date">${dateTime(sale.created_at)}</td>
        <td>${clientCell}</td>
        <td class="cell-summary">${summary}</td>
        <td class="cell-money cell-total">${fmtKES(sale.total)}</td>
        <td class="cell-money cell-cost">${fmtKES(saleCostAmount)}</td>
        <td>${paymentMethod(sale)}</td>
        <td class="cell-money">${fmtKES(paid)}</td>
        <td class="cell-money">${balanceCell}</td>
        <td class="cell-money ${saleProfitAmount >= 0 ? 'profit-positive' : 'profit-negative'}">${fmtKES(saleProfitAmount)}</td>
        <td>${tags}</td>
      </tr>`;
    }).join('') : '<tr><td colspan="10">No sales found for this period.</td></tr>';

    const periodButtons = [
      ['today', 'Today'],
      ['yesterday', 'Yesterday'],
      ['this_week', 'This Week'],
      ['this_month', 'This Month'],
      ['custom', 'Custom'],
    ].map(([key, label]) => `<button type="button" class="btn ${period === key ? 'btn-green' : 'btn-ghost'}" data-period="${key}">${label}</button>`).join('');

    app.innerHTML = `
      <div class="history-titlebar"><h1>Sales History</h1>
      <div class="history-filter-bar">${periodButtons}
        ${period === 'custom' ? `<label>From<input id="history-from" type="date" value="${escapeHtml(customFrom)}"></label><label>To<input id="history-to" type="date" value="${escapeHtml(customTo)}"></label>` : ''}
      </div></div>
      <section class="history-kpis">
        <article class="card"><h2>Total Revenue</h2><p>${fmtKES(revenue)}</p></article>
        <article class="card"><h2>Total Profit</h2><p class="${profit >= 0 ? 'profit-positive' : 'profit-negative'}">${fmtKES(profit)}</p></article>
        <article class="card"><h2>Sales Count</h2><p>${sales.length}</p></article>
        <article class="card history-top-products"><h2>Top 5 products</h2>${chart}</article>
      </section>
      <div class="table-scroll"><table class="data-table history-table">
        <thead><tr><th>Date/Time</th><th>Client</th><th>Items summary</th><th>Total</th><th>Cost</th><th>Method</th><th>Paid</th><th>Balance</th><th>Profit</th><th>Tags</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>`;

    app.querySelectorAll('[data-period]').forEach((button) => {
      button.addEventListener('click', () => {
        period = button.dataset.period;
        if (period === 'custom') {
          customFrom = today();
          customTo = today();
          app.innerHTML = '<p>Loading...</p>';
          loadSales();
        } else {
          app.innerHTML = '<p>Loading...</p>';
          loadSales();
        }
      });
    });
    const fromInput = document.getElementById('history-from');
    const toInput = document.getElementById('history-to');
    if (fromInput) fromInput.addEventListener('change', () => {
      customFrom = fromInput.value;
      if (customFrom && customTo) {
        app.innerHTML = '<p>Loading...</p>';
        loadSales();
      }
    });
    if (toInput) toInput.addEventListener('change', () => {
      customTo = toInput.value;
      if (customFrom && customTo) {
        app.innerHTML = '<p>Loading...</p>';
        loadSales();
      }
    });

    app.querySelectorAll('[data-sale-id]').forEach((row) => {
      row.addEventListener('click', (e) => {
        if (e.target.closest('[data-action="settle"]')) return;
        showSaleDetail(row.dataset.saleId);
      });
      row.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          showSaleDetail(row.dataset.saleId);
        }
      });
    });

    app.querySelectorAll('[data-action="settle"]').forEach((button) => {
      button.addEventListener('click', () => {
        const sale = sales.find((s) => s.id === button.dataset.id);
        if (!sale) return;
        let method = 'cash';
        openModal(`<form id="settle-credit-form" class="settle-credit-form">
          <h2>Settle — ${escapeHtml(sale.client_name || 'Walk-in')}</h2>
          <p>Outstanding balance: <strong>${fmtKES(sale.balance)}</strong></p>
          <label>Amount<input name="amount" type="number" min="1" step="1" value="${escapeHtml(String(Math.round(Number(sale.balance))))}" required></label>
          <fieldset><legend>Payment method</legend>
            <button type="button" class="btn btn-green" data-method="cash">Cash</button>
            <button type="button" class="btn btn-ghost" data-method="mpesa">M-Pesa</button>
          </fieldset>
          <div class="modal-actions">
            <button class="btn btn-green" type="submit">Record Payment</button>
            <button class="btn btn-ghost" type="button" data-modal-close>Cancel</button>
          </div>
        </form>`);

        const form = document.getElementById('settle-credit-form');
        form.querySelectorAll('[data-method]').forEach((btn) => {
          btn.addEventListener('click', () => {
            method = btn.dataset.method;
            form.querySelectorAll('[data-method]').forEach((b) => {
              b.classList.toggle('btn-green', b.dataset.method === method);
              b.classList.toggle('btn-ghost', b.dataset.method !== method);
            });
          });
        });
        form.addEventListener('submit', async (event) => {
          event.preventDefault();
          const submitButton = form.querySelector('[type="submit"]');
          const amount = Number(form.elements.amount.value);
          if (!Number.isFinite(amount) || amount < 1) {
            showToast('Enter a valid amount', 'error');
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
          showToast(`${fmtKES(amount)} payment recorded`);
          closeModal();
          loadSales();
        });
      });
    });
  }

  async function showSaleDetail(saleId) {
    const { data: sale, error } = await getSaleById(saleId);
    if (error) {
      showToast(error.message || 'Failed to load sale details', 'error');
      return;
    }
    const items = sale.sale_items ?? [];
    const rows = items.map((item) => {
      const itemProfit = (Number(item.unit_price || 0) - Number(item.unit_cost || 0)) * Number(item.qty || 0);
      return `<tr>
        <td>${escapeHtml(item.product_name || 'Product')}</td>
        <td>${escapeHtml(item.qty)}</td>
        <td>${escapeHtml(item.unit_sold)}</td>
        <td class="cell-money">${fmtKES(item.unit_price)}</td>
        <td class="cell-money cell-cost">${fmtKES(item.unit_cost)}</td>
        <td class="cell-money cell-total">${fmtKES(item.line_total)}</td>
        <td class="cell-money ${itemProfit >= 0 ? 'profit-positive' : 'profit-negative'}">${fmtKES(itemProfit)}</td>
      </tr>`;
    }).join('');
    openModal(`<section class="sale-detail-modal">
      <h2>Sale Details</h2>
      <p>${dateTime(sale.created_at)}</p>
      <p>${escapeHtml(sale.client_name || 'Walk-in')} · ${escapeHtml(sale.client_phone || 'No phone')}</p>
      <table class="data-table"><thead><tr><th>Product</th><th>Qty</th><th>Unit</th><th>Sell Price</th><th>Cost</th><th>Total</th><th>Profit</th></tr></thead><tbody>${rows}</tbody></table>
      <div class="sale-detail-totals">
        <p>Sale Total: ${fmtKES(sale.total)}</p>
        <p>Paid: ${fmtKES(sale.paid_cash)} cash + ${fmtKES(sale.paid_mpesa)} M-Pesa</p>
        <p>${Number(sale.balance || 0) < 0 ? `Change returned: ${fmtKES(Math.abs(Number(sale.balance)))}` : `Balance: ${fmtKES(sale.balance)}`}</p>
        <p class="sale-detail-profit ${saleProfit(sale) >= 0 ? 'profit-positive' : 'profit-negative'}">Profit: ${fmtKES(saleProfit(sale))}</p>
      </div>
      <div class="modal-actions"><button type="button" class="btn btn-green" id="open-return-management">Return Management</button><button type="button" class="btn btn-red" id="open-delete-sale">Delete sale</button><button type="button" class="btn btn-ghost" data-modal-close>Close</button></div>
    </section>`);
    document.getElementById('open-return-management').addEventListener('click', () => openReturnManagement(sale));
    document.getElementById('open-delete-sale').addEventListener('click', () => {
      openModal(`<div class="confirm-dialog">
        <p>Delete this sale? A snapshot will be archived, stock will be restored, and the sale's items, returns, and credit payments will be removed. This cannot be undone.</p>
        <div class="modal-actions"><button type="button" class="btn btn-red" id="confirm-delete-sale">Delete sale</button><button type="button" class="btn btn-ghost" id="cancel-delete-sale" data-modal-close>Cancel</button></div>
      </div>`);
      const confirmButton = document.getElementById('confirm-delete-sale');
      const cancelButton = document.getElementById('cancel-delete-sale');
      confirmButton.addEventListener('click', async (event) => {
        const button = event.currentTarget;
        button.disabled = true;
        cancelButton.disabled = true;
        button.textContent = 'Deleting...';
        let deleteError;
        try {
          ({ error: deleteError } = await deleteSale(sale.id));
        } catch (error) {
          deleteError = error;
        }
        if (deleteError) {
          showToast(deleteError.message || 'Could not delete sale', 'error');
          button.disabled = false;
          cancelButton.disabled = false;
          button.textContent = 'Delete sale';
          return;
        }
        closeModal();
        showToast('Sale deleted and stock restored');
        await refreshBanner();
        await loadSales();
      });
    });
  }

  async function openReturnManagement(sale) {
    const items = sale.sale_items ?? [];
    const itemRows = items.map((item, index) => `<tr>
      <td>${escapeHtml(item.product_name || 'Product')}</td>
      <td>${escapeHtml(item.qty)}</td>
      <td>${escapeHtml(item.unit_sold)}</td>
      <td>${fmtKES(item.unit_price)}</td>
      <td><button type="button" class="btn btn-ghost" data-refund-index="${index}">Refund</button><button type="button" class="btn btn-green" data-swap-index="${index}">Swap</button></td>
    </tr>`).join('');
    openModal(`<section class="return-management-modal">
      <h2>Return Management — ${escapeHtml(sale.client_name || 'Walk-in')}</h2>
      <div class="table-scroll"><table class="data-table"><thead><tr><th>Product</th><th>Qty</th><th>Unit</th><th>Unit Price</th><th>Actions</th></tr></thead><tbody>${itemRows}</tbody></table></div>
      <div class="modal-actions"><button type="button" class="btn btn-ghost" data-modal-close>Close</button></div>
    </section>`);

    document.querySelectorAll('[data-refund-index]').forEach((button) => {
      button.addEventListener('click', () => {
        const item = items[Number(button.dataset.refundIndex)];
        const refundAmount = Number(item.qty || 0) * Number(item.unit_price || 0);
        openModal(`<div class="refund-confirm-modal confirm-dialog">
          <h2>Confirm Refund</h2>
          <p>Refund ${escapeHtml(item.qty)} × ${escapeHtml(item.product_name || 'Product')} for ${fmtKES(refundAmount)}?</p>
          <div class="modal-actions"><button type="button" class="btn btn-red" id="confirm-refund">Confirm Refund</button><button type="button" class="btn btn-ghost" data-modal-close>Cancel</button></div>
        </div>`);
        document.getElementById('confirm-refund').addEventListener('click', async (event) => {
          const confirmButton = event.currentTarget;
          confirmButton.disabled = true;
          const { error: returnError } = await processReturn(sale.id, 'refund', [{
            sale_item_id: item.id,
            old_product_id: item.product_id,
            qty: item.qty,
          }], 'cash');
          if (returnError) {
            showToast(returnError.message || 'Failed to process refund', 'error');
            confirmButton.disabled = false;
            return;
          }
          showToast(`Refund processed. ${fmtKES(refundAmount)} returned to client.`);
          closeModal();
          renderHistory();
        });
      });
    });

    document.querySelectorAll('[data-swap-index]').forEach((button) => {
      button.addEventListener('click', async () => {
        const item = items[Number(button.dataset.swapIndex)];
        const { data: products, error: productsError } = await getProducts();
        if (productsError) {
          showToast(productsError.message || 'Failed to load replacement products', 'error');
          return;
        }
        let selectedProduct = null;
        let selectedMethod = 'cash';
        const originalCost = Number(item.qty || 0) * Number(item.unit_price || 0);
        openModal(`<form id="swap-form" class="swap-form">
          <h2>Swap ${escapeHtml(item.product_name || 'Product')}</h2>
          <label>Search replacement product<input id="replacement-search" type="search" autocomplete="off"></label>
          <div id="replacement-results" class="replacement-results"></div>
          <label>New quantity<input id="replacement-qty" type="number" min="0.001" step="any" value="${escapeHtml(item.qty)}"></label>
          <p id="swap-comparison">Original: ${fmtKES(originalCost)} → New: ${fmtKES(0)}</p>
          <p id="swap-difference" class="hidden"></p>
          <label>Payment/refund method<select id="swap-method"><option value="cash">Cash</option><option value="mpesa">M-Pesa</option></select></label>
          <div class="modal-actions"><button type="submit" class="btn btn-green">Confirm Swap</button><button type="button" class="btn btn-ghost" data-modal-close>Cancel</button></div>
        </form>`);

        const replacementSearch = document.getElementById('replacement-search');
        const replacementResults = document.getElementById('replacement-results');
        const replacementQty = document.getElementById('replacement-qty');
        const comparison = document.getElementById('swap-comparison');
        const difference = document.getElementById('swap-difference');
        const form = document.getElementById('swap-form');

        function renderReplacementResults() {
          const search = replacementSearch.value.trim().toLowerCase();
          const matches = (products ?? []).filter((product) => product.name.toLowerCase().includes(search)).slice(0, 8);
          replacementResults.innerHTML = matches.map((product) => `<button type="button" class="replacement-option" data-product-id="${escapeHtml(product.id)}">${escapeHtml(product.name)} · ${escapeHtml(productSize(product) || product.category)} · ${fmtKES(product.sell_price)}</button>`).join('');
          replacementResults.querySelectorAll('[data-product-id]').forEach((option) => {
            option.addEventListener('click', () => {
              selectedProduct = matches.find((product) => product.id === option.dataset.productId);
              replacementSearch.value = selectedProduct.name;
              replacementResults.innerHTML = '';
              updateSwapPreview();
            });
          });
        }

        function updateSwapPreview() {
          const newTotal = selectedProduct ? Number(replacementQty.value || 0) * Number(selectedProduct.sell_price || 0) : 0;
          comparison.textContent = `Original: ${fmtKES(originalCost)} → New: ${fmtKES(newTotal)}`;
          const delta = newTotal - originalCost;
          if (!selectedProduct || Math.abs(delta) < 0.005) {
            difference.classList.add('hidden');
            difference.textContent = '';
          } else {
            difference.textContent = delta > 0 ? `Client pays ${fmtKES(delta)} extra` : `Refund ${fmtKES(Math.abs(delta))} to client`;
            difference.classList.remove('hidden');
          }
        }

        replacementSearch.addEventListener('input', () => {
          selectedProduct = null;
          updateSwapPreview();
          renderReplacementResults();
        });
        replacementQty.addEventListener('input', updateSwapPreview);
        document.getElementById('swap-method').addEventListener('change', (event) => { selectedMethod = event.target.value; });
        renderReplacementResults();

        form.addEventListener('submit', async (event) => {
          event.preventDefault();
          const submitButton = form.querySelector('[type="submit"]');
          const newQty = Number(replacementQty.value);
          if (!selectedProduct || !Number.isFinite(newQty) || newQty <= 0) {
            showToast('Choose a replacement product and enter a valid quantity', 'error');
            return;
          }
          submitButton.disabled = true;
          const { error: swapError } = await processReturn(sale.id, 'swap', [{
            sale_item_id: item.id,
            old_product_id: item.product_id,
            qty: item.qty,
            new_product_id: selectedProduct.id,
            new_qty: newQty,
          }], selectedMethod);
          if (swapError) {
            showToast(swapError.message || 'Failed to process swap', 'error');
            submitButton.disabled = false;
            return;
          }
          showToast('Swap processed.');
          closeModal();
          renderHistory();
        });
      });
    });
  }

  const overlay = document.getElementById('modal-overlay');
  if (!overlay.dataset.historyCloseBound) {
    overlay.addEventListener('click', (event) => {
      if (event.target.closest('[data-modal-close]')) closeModal();
    });
    overlay.dataset.historyCloseBound = 'true';
  }

  await loadSales();
}
