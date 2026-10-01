import { getProducts } from '../services/products.js';
import { createSale } from '../services/sales.js';
import { refreshBanner } from '../components/banner.js';
import { openModal, closeModal } from '../components/modal.js';
import { showToast } from '../components/toast.js';
import { fmtKES } from '../utils.js';
import { buildReceiptPreviewHTML, openPrintWindow, openWhatsApp } from '../components/receipt.js';

function escapeHtml(v) {
  return String(v ?? '').replace(/[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function productSize(product) {
  return [product.size_value, product.size_unit].filter((v) => v !== null && v !== '').join(' ');
}

// Price to charge for one unit given the cart item's current unit selection
function priceFor(item) {
  return item.price; // cashier-editable; initialised from product defaults
}

function defaultPrice(product, unit) {
  return unit === 'carton'
    ? Number(product.carton_sell_price || 0)
    : Number(product.sell_price || 0);
}

// Units of stock_qty consumed by this cart item
function stockUsed(item) {
  if (item.product.category === 'carton' && item.unit === 'carton') {
    return item.qty * Number(item.product.pieces_per_carton || 0);
  }
  return item.qty;
}

export async function renderSell() {
  const app = document.getElementById('app');
  app.innerHTML = '<p>Loading...</p>';

  const { data, error } = await getProducts();
  if (error) {
    app.innerHTML = '<p class="error">Failed to load products.</p>';
    return;
  }

  const products = data ?? [];
  const cart = [];
  let paymentMode = 'cash';
  let clientName = '';
  let clientPhone = '';
  let amountPaid = 0;
  let splitCash = 0;
  let splitMpesa = 0;

  app.innerHTML = `
    <div class="sell-layout">

      <!-- Left: product search -->
      <section class="sell-left">
        <h1>Sell</h1>
        <input id="product-search" type="search" placeholder="Search products…" aria-label="Search products">
        <div id="product-results" class="product-results"></div>
      </section>

      <!-- Right: cart table + checkout -->
      <section class="sell-right">
        <div class="cart-table-wrap">
          <table class="cart-table">
            <colgroup>
              <col class="cart-col-product">
              <col class="cart-col-qty">
              <col class="cart-col-unit">
              <col class="cart-col-price">
              <col class="cart-col-total">
              <col class="cart-col-remove">
            </colgroup>
            <thead>
              <tr>
                <th>Product</th>
                <th>Qty</th>
                <th>Unit</th>
                <th class="col-r">Sell Price</th>
                <th class="col-r">Total</th>
                <th></th>
              </tr>
            </thead>
            <tbody id="cart-tbody"></tbody>
          </table>
        </div>

        <div class="checkout-panel">

          <!-- Payment method -->
          <div class="checkout-pay-row">
            <span class="checkout-field-label">Payment</span>
            <div class="payment-methods" role="group" aria-label="Payment method">
              <button type="button" class="btn" data-payment-mode="cash">Cash</button>
              <button type="button" class="btn" data-payment-mode="mpesa">M-Pesa</button>
              <button type="button" class="btn" data-payment-mode="split">Split</button>
            </div>
          </div>

          <!-- Split sub-fields -->
          <div id="split-payment-fields" class="split-payment-fields hidden">
            <label>Cash KES<input id="split-cash" type="number" min="0" step="0.01" value="0"></label>
            <label>M-Pesa KES<input id="split-mpesa" type="number" min="0" step="0.01" value="0"></label>
          </div>

          <!-- Total → Amount paid → Balance -->
          <div class="checkout-amounts">
            <div class="checkout-total-line">
              <span class="checkout-field-label">Cart total</span>
              <span id="cart-total" class="cart-grand-total">${fmtKES(0)}</span>
            </div>
            <label class="checkout-paid-wrap">
              <span class="checkout-field-label">Amount paid</span>
              <input id="amount-paid" type="number" min="0" step="0.01" value="0" placeholder="0">
            </label>
            <div id="checkout-balance" class="checkout-balance-line hidden"></div>
          </div>

          <!-- Client -->
          <div class="checkout-client-row">
            <label>Client name<input id="client-name" type="text" autocomplete="name" placeholder="Optional"></label>
            <label>Phone<input id="client-phone" type="tel" autocomplete="tel" placeholder="Optional"></label>
          </div>
          <p id="credit-name-error" class="error hidden">Client name is required for credit sales.</p>

          <button id="save-sale" class="btn btn-green" type="button" disabled>Save Sale</button>
        </div>
      </section>
    </div>`;

  const tbody = document.getElementById('cart-tbody');
  const resultsEl = document.getElementById('product-results');

  // ── helpers ────────────────────────────────────────────────────────────────

  function totalForCart() {
    return cart.reduce((sum, item) => sum + item.qty * priceFor(item), 0);
  }

  function availableFor(item) {
    const otherUsed = cart
      .filter((other) => other.product.id === item.product.id && other !== item)
      .reduce((sum, other) => sum + stockUsed(other), 0);
    return Number(item.product.stock_qty || 0) - otherUsed;
  }

  function oversellFor(item) {
    return stockUsed(item) > availableFor(item) + 1e-9;
  }

  // ── product results ────────────────────────────────────────────────────────

  function renderResults() {
    const search = document.getElementById('product-search').value.trim().toLowerCase();
    const filtered = products.filter((p) => p.name.toLowerCase().includes(search));

    if (!filtered.length) {
      resultsEl.innerHTML = '<p class="no-results">No products found.</p>';
      return;
    }

    resultsEl.innerHTML = filtered.map((product) => {
      const inCart = cart
        .filter((i) => i.product.id === product.id)
        .reduce((sum, i) => sum + stockUsed(i), 0);
      const remaining = Math.max(Number(product.stock_qty || 0) - inCart, 0);
      const stockUnit = product.category === 'bag' ? 'kg' : 'pcs';
      const sub = productSize(product) || (product.category === 'carton' ? 'Carton' : product.category === 'bag' ? 'Bag' : 'Pieces');

      let priceStr;
      if (product.category === 'carton') {
        priceStr = `${fmtKES(product.sell_price)}/pc${product.carton_sell_price ? ` · ${fmtKES(product.carton_sell_price)}/ctn` : ''}`;
      } else if (product.category === 'bag') {
        priceStr = `${fmtKES(product.sell_price)}/kg`;
      } else {
        priceStr = `${fmtKES(product.sell_price)}/pc`;
      }

      return `<button type="button" class="product-result" data-add-product="${escapeHtml(product.id)}">
        <div class="product-result-info">
          <strong>${escapeHtml(product.name)}</strong>
          <small>${escapeHtml(sub)}</small>
        </div>
        <div class="product-result-meta">
          <span class="product-result-price">${priceStr}</span>
          <span class="product-result-stock">Stock: ${escapeHtml(String(remaining))} ${stockUnit}</span>
        </div>
      </button>`;
    }).join('');
  }

  // ── cart row HTML ──────────────────────────────────────────────────────────

  function cartRowHtml(item, index) {
    const product = item.product;
    const unitPrice = priceFor(item);
    const total = item.qty * unitPrice;
    const oversell = oversellFor(item);
    const availableRaw = Math.max(availableFor(item), 0);
    const availableDisplay = product.category === 'carton' && item.unit === 'carton'
      ? (availableRaw / Math.max(Number(product.pieces_per_carton || 1), 1)).toFixed(1)
      : String(availableRaw);

    const minQty = product.category === 'bag' ? '0.5' : '1';
    const stepQty = product.category === 'bag' ? '0.5' : '1';
    const invalidQty = !Number.isFinite(item.qty) || item.qty < Number(minQty);
    const hasErr = oversell || invalidQty;

    const sub = productSize(product) || (product.category === 'carton' ? 'Carton' : product.category === 'bag' ? 'Bag' : 'Pieces');

    // Unit cell — dropdown for carton, static label for others
    let unitCell;
    if (product.category === 'carton') {
      unitCell = `<select class="cart-unit-select" data-unit-index="${index}">
        <option value="piece" ${item.unit === 'piece' ? 'selected' : ''}>Piece</option>
        <option value="carton" ${item.unit === 'carton' ? 'selected' : ''}>Carton</option>
      </select>`;
    } else {
      unitCell = `<span class="cart-unit-label">${product.category === 'bag' ? 'kg' : 'pc'}</span>`;
    }

    return `<tr data-cart-index="${index}" class="${hasErr ? 'cart-row-error' : ''}">
      <td class="cart-col-product">
        <strong>${escapeHtml(product.name)}</strong>
        <small>${escapeHtml(sub)}</small>
        ${oversell ? `<span class="cart-stock-error">Only ${escapeHtml(availableDisplay)} available</span>` : ''}
        ${!oversell && invalidQty ? '<span class="cart-stock-error">Enter a valid quantity</span>' : ''}
      </td>
      <td class="cart-col-qty">
        <input class="cart-qty${hasErr ? ' input-error' : ''}" data-qty-index="${index}"
          type="number" min="${minQty}" step="${stepQty}" value="${escapeHtml(String(item.qty))}"
          aria-label="Quantity">
      </td>
      <td class="cart-col-unit">${unitCell}</td>
      <td class="cart-col-price">
        <input type="number" class="cart-price-input" data-price-index="${index}"
          min="0" step="0.01" value="${escapeHtml(String(unitPrice))}" aria-label="Sell price">
      </td>
      <td class="cart-col-total">${fmtKES(total)}</td>
      <td class="cart-col-remove">
        <button type="button" class="remove-cart-item" data-remove-cart="${index}" aria-label="Remove ${escapeHtml(product.name)}">×</button>
      </td>
    </tr>`;
  }

  function renderCart() {
    if (!cart.length) {
      tbody.innerHTML = `<tr><td colspan="6" class="cart-empty">Cart is empty — add products from the list.</td></tr>`;
    } else {
      tbody.innerHTML = cart.map((item, i) => cartRowHtml(item, i)).join('')
        + `<tr><td colspan="6" class="cart-add-row">
             <button type="button" id="add-more-items" class="btn btn-ghost cart-add-btn">+ Add more items</button>
           </td></tr>`;
    }

    const total = totalForCart();
    document.getElementById('cart-total').textContent = fmtKES(total);
    renderCheckoutState();
    renderResults();
  }

  // ── checkout state ─────────────────────────────────────────────────────────

  function renderCheckoutState() {
    const total = totalForCart();
    const isSplit = paymentMode === 'split';
    const amountInput = document.getElementById('amount-paid');

    // Payment mode buttons
    document.querySelectorAll('[data-payment-mode]').forEach((btn) => {
      btn.classList.toggle('btn-green', btn.dataset.paymentMode === paymentMode);
      btn.classList.toggle('btn-ghost', btn.dataset.paymentMode !== paymentMode);
    });

    // Split sub-fields
    document.getElementById('split-payment-fields').classList.toggle('hidden', !isSplit);
    document.getElementById('split-cash').value = String(splitCash);
    document.getElementById('split-mpesa').value = String(splitMpesa);

    // Amount paid field — hidden and auto-computed for split
    amountInput.readOnly = isSplit;
    amountInput.value = String(amountPaid);

    // Balance line
    const balance = Math.max(total - Number(amountPaid || 0), 0);
    const balanceLine = document.getElementById('checkout-balance');
    if (total > 0) {
      balanceLine.textContent = balance > 0
        ? `Balance: ${fmtKES(balance)}`
        : `Change: ${fmtKES(Number(amountPaid || 0) - total)}`;
      balanceLine.className = balance > 0 ? 'checkout-balance-line balance-owed' : 'checkout-balance-line balance-clear';
    } else {
      balanceLine.className = 'checkout-balance-line hidden';
    }

    const clientRequired = balance > 0 && !clientName.trim();
    document.getElementById('credit-name-error').classList.toggle('hidden', !clientRequired);
    document.getElementById('save-sale').disabled =
      !cart.length ||
      clientRequired ||
      cart.some((item) => oversellFor(item) || !Number.isFinite(item.qty) ||
        item.qty < (item.product.category === 'bag' ? 0.5 : 1));
  }

  // ── event wiring ───────────────────────────────────────────────────────────

  document.getElementById('product-search').addEventListener('input', renderResults);

  document.getElementById('client-name').addEventListener('input', (e) => {
    clientName = e.target.value; renderCheckoutState();
  });
  document.getElementById('client-phone').addEventListener('input', (e) => {
    clientPhone = e.target.value;
  });
  document.getElementById('amount-paid').addEventListener('input', (e) => {
    amountPaid = Number(e.target.value) || 0; renderCheckoutState();
  });
  document.getElementById('split-cash').addEventListener('input', (e) => {
    splitCash = Number(e.target.value) || 0;
    amountPaid = splitCash + splitMpesa;
    renderCheckoutState();
  });
  document.getElementById('split-mpesa').addEventListener('input', (e) => {
    splitMpesa = Number(e.target.value) || 0;
    amountPaid = splitCash + splitMpesa;
    renderCheckoutState();
  });
  document.querySelectorAll('[data-payment-mode]').forEach((btn) => {
    btn.addEventListener('click', () => {
      paymentMode = btn.dataset.paymentMode;
      if (paymentMode === 'split') { splitCash = amountPaid; splitMpesa = 0; }
      renderCheckoutState();
    });
  });

  // "Add more items" button — scroll to and focus the search input
  tbody.addEventListener('click', (e) => {
    if (e.target.closest('#add-more-items')) {
      const search = document.getElementById('product-search');
      search.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      search.focus();
    }
  });

  // Add product to cart
  resultsEl.addEventListener('click', (e) => {
    const button = e.target.closest('[data-add-product]');
    if (!button) return;
    const product = products.find((p) => p.id === button.dataset.addProduct);
    if (!product) return;
    const existing = cart.find((i) => i.product.id === product.id);
    if (existing) {
      existing.qty += product.category === 'bag' ? 0.5 : 1;
    } else {
      const initUnit = product.category === 'carton' ? 'piece' : product.category === 'bag' ? 'kg' : 'piece';
      cart.push({
        product,
        qty: product.category === 'bag' ? 0.5 : 1,
        unit: initUnit,
        price: defaultPrice(product, initUnit),
      });
    }
    renderCart();
  });

  tbody.addEventListener('input', (e) => {
    // Price edit — targeted update, no full re-render (preserves focus)
    const priceInput = e.target.closest('[data-price-index]');
    if (priceInput) {
      const index = Number(priceInput.dataset.priceIndex);
      cart[index].price = Number(priceInput.value) || 0;
      const row = tbody.querySelector(`tr[data-cart-index="${index}"]`);
      if (row) row.querySelector('.cart-col-total').textContent = fmtKES(cart[index].qty * cart[index].price);
      document.getElementById('cart-total').textContent = fmtKES(totalForCart());
      renderCheckoutState();
      return;
    }

    // Qty edit
    const qtyInput = e.target.closest('[data-qty-index]');
    if (!qtyInput) return;
    const index = Number(qtyInput.dataset.qtyIndex);
    cart[index].qty = Number(qtyInput.value) || 0;
    const cursor = qtyInput.selectionStart;
    renderCart();
    const replacement = tbody.querySelector(`[data-qty-index="${index}"]`);
    if (replacement) {
      replacement.focus();
      if (cursor !== null) replacement.setSelectionRange(cursor, cursor);
    }
  });

  // Unit dropdown change (carton only)
  tbody.addEventListener('change', (e) => {
    const unitSel = e.target.closest('[data-unit-index]');
    if (!unitSel) return;
    const index = Number(unitSel.dataset.unitIndex);
    const item = cart[index];
    const newUnit = unitSel.value;
    if (item.unit !== newUnit) {
      const ppc = Number(item.product.pieces_per_carton || 0);
      item.qty = newUnit === 'piece'
        ? Math.round(item.qty * ppc)
        : Math.max(1, Math.round(item.qty / ppc));
      item.unit = newUnit;
      item.price = defaultPrice(item.product, newUnit);
    }
    renderCart();
  });

  // Remove button
  tbody.addEventListener('click', (e) => {
    const removeBtn = e.target.closest('[data-remove-cart]');
    if (!removeBtn) return;
    cart.splice(Number(removeBtn.dataset.removeCart), 1);
    renderCart();
  });

  // ── save sale ──────────────────────────────────────────────────────────────

  document.getElementById('save-sale').addEventListener('click', async (e) => {
    const button = e.currentTarget;
    if (!cart.length || cart.some((item) =>
      oversellFor(item) || !Number.isFinite(item.qty) ||
      item.qty < (item.product.category === 'bag' ? 0.5 : 1))) {
      showToast('Review the cart quantities before saving', 'error');
      return;
    }
    const total = totalForCart();
    const rawPaid = Number(amountPaid) || 0;
    // Cap recorded payment at total — overpayment is change returned, not credit
    const paid = Math.min(rawPaid, total);
    if (rawPaid < total && !clientName.trim()) {
      showToast('Client name is required for credit sales.', 'error');
      return;
    }

    const items = cart.map((item) => ({
      product_id: item.product.id,
      qty: item.qty,
      unit_sold: item.product.category === 'bag' ? 'kg'
        : item.product.category === 'carton' ? item.unit
        : 'piece',
      unit_price: priceFor(item),
      unit_cost: item.product.category === 'carton' && item.unit === 'carton'
        ? Number(item.product.cost_price || 0) * Number(item.product.pieces_per_carton || 1)
        : Number(item.product.cost_price || 0),
    }));
    // For split: reduce cash first if overpaid (change is given in cash)
    const splitCashCapped  = Math.min(splitCash, total);
    const splitMpesaCapped = Math.min(splitMpesa, Math.max(0, total - splitCashCapped));
    const paidCash  = paymentMode === 'cash'  ? paid : paymentMode === 'split' ? splitCashCapped  : 0;
    const paidMpesa = paymentMode === 'mpesa' ? paid : paymentMode === 'split' ? splitMpesaCapped : 0;

    button.disabled = true;
    button.textContent = 'Saving…';

    const { data: saleId, error: saleError } = await createSale(
      clientName.trim() || null, clientPhone.trim() || null, items, paidCash, paidMpesa,
    );
    if (saleError) {
      showToast(saleError.message || 'Failed to save sale', 'error');
      button.textContent = 'Save Sale';
      renderCheckoutState();
      return;
    }

    const saleObj = {
      id: saleId,
      created_at: new Date().toISOString(),
      client_name: clientName.trim() || null,
      client_phone: clientPhone.trim() || null,
      total,
      paid_cash: paidCash,
      paid_mpesa: paidMpesa,
    };
    const saleItemsForReceipt = cart.map((item) => ({
      product_name: item.product.name,
      qty: item.qty,
      unit_sold: item.product.category === 'bag' ? 'kg'
        : item.product.category === 'carton' ? item.unit
        : 'piece',
      unit_price: priceFor(item),
      line_total: item.qty * priceFor(item),
    }));
    const balance = Math.max(total - paidCash - paidMpesa, 0);

    await refreshBanner();
    cart.length = 0;
    renderCart();

    if (balance > 0) {
      const name = clientName.trim() || 'Walk-in';
      showToast(`${name} owes ${fmtKES(balance)} — recorded as credit`, 'success', 5000);
    }

    let receiptPaperSize = '80';
    let receiptServedBy = '';

    function buildReceiptModal() {
      return `<div class="sale-receipt-modal">
        <div class="receipt-toolbar">
          <h2>Sale Recorded</h2>
          <div class="receipt-toolbar-actions">
            <div class="paper-toggle">
              <button type="button" class="btn ${receiptPaperSize === '58' ? 'btn-green' : 'btn-ghost'}" data-paper="58">58mm</button>
              <button type="button" class="btn ${receiptPaperSize === '80' ? 'btn-green' : 'btn-ghost'}" data-paper="80">80mm</button>
            </div>
            <input id="served-by" type="text" placeholder="Served by" value="${receiptServedBy}">
          </div>
        </div>
        <div id="receipt-preview" class="receipt-preview">
          ${buildReceiptPreviewHTML(saleObj, saleItemsForReceipt, receiptPaperSize)}
        </div>
        <div class="modal-actions">
          <button type="button" class="btn btn-green"  id="btn-print-receipt">Print</button>
          <button type="button" class="btn btn-ghost"  id="btn-whatsapp-receipt">WhatsApp</button>
          <button type="button" class="btn btn-ghost"  id="close-sale-receipt">Close</button>
        </div>
      </div>`;
    }

    openModal(buildReceiptModal());

    function bindReceiptModal() {
      document.querySelectorAll('[data-paper]').forEach((btn) => {
        btn.addEventListener('click', () => {
          receiptPaperSize = btn.dataset.paper;
          document.getElementById('modal-overlay').querySelector('.modal').innerHTML = buildReceiptModal();
          bindReceiptModal();
        });
      });
      const servedByInput = document.getElementById('served-by');
      if (servedByInput) servedByInput.addEventListener('input', (ev) => { receiptServedBy = ev.target.value; });
      document.getElementById('btn-print-receipt')?.addEventListener('click', () => {
        openPrintWindow(saleObj, saleItemsForReceipt, receiptServedBy, receiptPaperSize);
      });
      document.getElementById('btn-whatsapp-receipt')?.addEventListener('click', () => {
        openWhatsApp(saleObj, saleItemsForReceipt);
      });
      document.getElementById('close-sale-receipt')?.addEventListener('click', () => {
        closeModal();
        renderSell();
      });
    }
    bindReceiptModal();
  });

  // ── initial render ─────────────────────────────────────────────────────────
  renderResults();
  renderCart();
}
