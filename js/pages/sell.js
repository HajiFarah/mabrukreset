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
  const sp  = Number(product.sell_price || 0);
  const csp = Number(product.carton_sell_price || 0);
  const bsp = Number(product.box_sell_price || 0);
  if (unit === 'carton' || unit === 'dozen')
    return csp || sp * Number(product.pieces_per_carton || 0);
  if (unit === 'bag')  return sp * Number(product.bag_weight || 0);
  if (unit === 'box')  return sp * piecesPerBox(product);
  if (unit === 'tray') return bsp || sp * Number(product.pieces_per_box || 0);
  return sp; // 'piece' or 'kg'
}

// Pieces per box for carton_box products (packets_per_box = boxes per carton)
function piecesPerBox(product) {
  const ppc = Number(product.pieces_per_carton || 0);
  const bpc = Number(product.packets_per_box || 0);
  return ppc && bpc ? ppc / bpc : 0;
}

// Minimum valid qty for a cart item given its current unit
function minQtyFor(item) {
  if (item.unit === 'kg')    return 0.001; // any loose weight
  if (item.unit === 'piece') return 1;     // whole pieces only
  return 0.5;                              // carton / bag / box / tray / crate / dozen — allow halves
}

// Maximum valid qty given available raw stock units and the selling unit
// avail = raw stock (pcs or kg), product = product record
function maxQtyFor(unit, avail, product) {
  const ppc  = Number(product.pieces_per_carton || 0);
  const ppb  = piecesPerBox(product);
  const ppbt = Number(product.pieces_per_box || 0);
  const bw   = Number(product.bag_weight || 0);
  if (unit === 'piece') return Math.floor(avail);
  if (unit === 'kg')    return avail;                                              // any fraction up to stock
  if ((unit === 'carton' || unit === 'dozen') && ppc) return Math.floor(avail / ppc  * 2) / 2; // nearest 0.5
  if (unit === 'bag'  && bw)   return Math.floor(avail / bw   * 2) / 2;
  if (unit === 'box'  && ppb)  return Math.floor(avail / ppb  * 2) / 2;
  if (unit === 'tray' && ppbt) return Math.floor(avail / ppbt * 2) / 2;
  return avail;
}

// Units of stock_qty consumed by this cart item
function stockUsed(item) {
  const { product, unit } = item;
  const qty = item.qty ?? 0;
  if (unit === 'carton' || unit === 'dozen')
    return qty * Number(product.pieces_per_carton || 0);
  if (unit === 'bag')  return qty * Number(product.bag_weight || 0);
  if (unit === 'box')  return qty * piecesPerBox(product);
  if (unit === 'tray') return qty * Number(product.pieces_per_box || 0);
  return qty; // 'piece' or 'kg'
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
          <div class="checkout-top-row">
            <div class="checkout-pay-row">
              <span class="checkout-field-label">Payment</span>
              <div class="payment-methods" role="group" aria-label="Payment method">
                <button type="button" class="btn" data-payment-mode="cash">Cash</button>
                <button type="button" class="btn" data-payment-mode="mpesa">M-Pesa</button>
                <button type="button" class="btn" data-payment-mode="split">Split</button>
              </div>
            </div>

            <div class="checkout-total-line">
              <span class="checkout-field-label">Cart total</span>
              <span id="cart-total" class="cart-grand-total">${fmtKES(0)}</span>
            </div>

            <label class="checkout-paid-wrap">
              <span class="checkout-field-label">Amount paid</span>
              <input id="amount-paid" type="number" min="0" step="0.01" value="0" placeholder="0">
            </label>

            <div id="checkout-balance" class="checkout-balance-line hidden"></div>

            <div id="split-payment-fields" class="split-payment-fields hidden">
              <label>Cash KES<input id="split-cash" type="number" min="0" step="0.01" value="0"></label>
              <label>M-Pesa KES<input id="split-mpesa" type="number" min="0" step="0.01" value="0"></label>
            </div>
          </div>

          <div class="checkout-client-row">
            <div class="checkout-client-name-wrap">
              <label>Client name<input id="client-name" type="text" autocomplete="name" placeholder="Optional"></label>
              <p id="credit-name-error" class="error hidden">Client name is required for credit sales.</p>
            </div>
            <label>Phone<input id="client-phone" type="tel" autocomplete="tel" placeholder="Optional"></label>
          </div>

          <div class="checkout-actions">
            <button type="button" id="add-more-items" class="btn btn-ghost">+ Add product</button>
            <button type="button" id="cancel-sale" class="btn btn-ghost">Cancel</button>
            <button id="save-sale" class="btn btn-green" type="button" disabled>Save Sale</button>
          </div>
        </div>
      </section>
    </div>`;

  const tbody = document.getElementById('cart-tbody');
  const resultsEl = document.getElementById('product-results');

  // ── helpers ────────────────────────────────────────────────────────────────

  function totalForCart() {
    return cart.reduce((sum, item) => sum + (item.qty ?? 0) * priceFor(item), 0);
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

    const rows = filtered.map((product) => {
      const inCart = cart
        .filter((i) => i.product.id === product.id)
        .reduce((sum, i) => sum + stockUsed(i), 0);
      const remaining = Math.max(Number(product.stock_qty || 0) - inCart, 0);
      const stockUnit = product.category === 'bag' ? 'kg' : 'pcs';
      const sub = productSize(product) || (product.category === 'carton' ? 'Carton' : product.category === 'bag' ? 'Bag' : product.category === 'crate' ? 'Crate' : product.category === 'dozen' ? 'Dozen' : 'Pieces');

      let priceStr;
      if (product.category === 'carton') {
        priceStr = `${fmtKES(product.sell_price)}/pc${product.carton_sell_price ? ` · ${fmtKES(product.carton_sell_price)}/ctn` : ''}`;
      } else if (product.category === 'bag') {
        priceStr = `${fmtKES(product.sell_price)}/kg`;
      } else if (product.category === 'crate') {
        priceStr = `${fmtKES(product.sell_price)}/pc${product.box_sell_price ? ` · ${fmtKES(product.box_sell_price)}/tray` : ''}${product.carton_sell_price ? ` · ${fmtKES(product.carton_sell_price)}/crate` : ''}`;
      } else if (product.category === 'dozen') {
        priceStr = `${fmtKES(product.sell_price)}/pc${product.carton_sell_price ? ` · ${fmtKES(product.carton_sell_price)}/doz` : ''}`;
      } else {
        priceStr = `${fmtKES(product.sell_price)}/pc`;
      }

      return `<tr class="product-row" data-add-product="${escapeHtml(product.id)}">
        <td><span class="pt-name">${escapeHtml(product.name)}</span></td>
        <td><span class="pt-sub">${escapeHtml(sub)}</span></td>
        <td class="col-r"><span class="pt-price">${priceStr}</span></td>
        <td class="col-r"><span class="pt-stock">${escapeHtml(String(remaining))} ${stockUnit}</span></td>
      </tr>`;
    }).join('');

    resultsEl.innerHTML = `<table class="product-table">
      <thead><tr><th>Product</th><th>Size</th><th class="col-r">Price</th><th class="col-r">Stock</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
  }

  // ── cart row HTML ──────────────────────────────────────────────────────────

  function cartRowHtml(item, index) {
    const product = item.product;
    const unitPrice = priceFor(item);
    const total = (item.qty ?? 0) * unitPrice;
    const oversell = oversellFor(item);
    const availableRaw = Math.max(availableFor(item), 0);
    const ppc = Number(product.pieces_per_carton || 0);
    const ppb = piecesPerBox(product);
    const ppbt = Number(product.pieces_per_box || 0); // pieces per tray (crate)
    const bw  = Number(product.bag_weight || 0);

    const minQtyV  = minQtyFor(item);
    const minQty   = String(minQtyV);
    const stepQty  = item.unit === 'kg' ? 'any' : item.unit === 'piece' ? '1' : '0.5';
    const maxQtyV  = maxQtyFor(item.unit, availableRaw, product);
    const maxQty   = String(maxQtyV);
    // null = blank (waiting for input) — show no error, just keep save disabled
    const invalidQty = item.qty !== null && item.qty < minQtyV;
    const hasErr = oversell || invalidQty;

    const sub = productSize(product) || (product.category === 'carton' ? 'Carton' : product.category === 'bag' ? 'Bag' : product.category === 'carton_box' ? 'Carton+Box' : product.category === 'crate' ? 'Crate' : product.category === 'dozen' ? 'Dozen' : 'Pieces');

    // Descriptive labels — show the piece/kg count so cashier knows exactly what they're selecting
    const _ppc  = Number(product.pieces_per_carton || 0);
    const _ppb  = piecesPerBox(product);                       // carton_box: pcs per inner box
    const _ppbt = Number(product.pieces_per_box || 0);         // crate: pcs per tray
    const _bw   = Number(product.bag_weight || 0);

    const lCtn   = _ppc  ? `Carton (${_ppc} pcs)`    : 'Carton';
    const lInner = _ppb  ? `Inner Box (${_ppb} pcs)`  : 'Inner Box';
    const lTray  = _ppbt ? `Tray (${_ppbt} pcs)`      : 'Tray';
    const lDoz   = _ppc  ? `Dozen (${_ppc} pcs)`      : 'Dozen';
    const lBag   = _bw   ? `Bag (${_bw} kg)`           : 'Bag';

    // Short label used in the collapsed cart row summary
    const collapsedUnitLabel = item.unit === 'carton' ? 'ctn'
      : item.unit === 'dozen'    ? 'doz'
      : item.unit === 'tray'     ? 'tray'
      : item.unit === 'bag'      ? 'bag'
      : item.unit === 'box'      ? 'inner box'
      : item.unit === 'kg'       ? 'kg'
      : 'pc';

    if (item.collapsed && !hasErr) {
      return `<tr data-cart-index="${index}" class="cart-row-collapsed">
        <td colspan="5" class="cart-collapsed-summary">
          <strong>${escapeHtml(product.name)}</strong>
          <span>${escapeHtml(String(item.qty))} ${collapsedUnitLabel}</span>
          <span>@ ${fmtKES(unitPrice)}</span>
          <strong class="cart-collapsed-total">${fmtKES(total)}</strong>
        </td>
        <td class="cart-col-remove">
          <button type="button" class="remove-cart-item" data-remove-cart="${index}" aria-label="Remove ${escapeHtml(product.name)}">×</button>
        </td>
      </tr>`;
    }

    // Unit cell — dropdown per category with descriptive labels
    let unitCell;
    if (product.category === 'carton') {
      // Stock tracked as pieces → sell by piece or full carton
      unitCell = `<select class="cart-unit-select" data-unit-index="${index}">
        <option value="piece"  ${item.unit === 'piece'  ? 'selected' : ''}>Piece</option>
        <option value="carton" ${item.unit === 'carton' ? 'selected' : ''}>${escapeHtml(lCtn)}</option>
      </select>`;
    } else if (product.category === 'bag') {
      // Stock tracked as kg → sell by loose kg or full bag
      unitCell = `<select class="cart-unit-select" data-unit-index="${index}">
        <option value="kg"  ${item.unit === 'kg'  ? 'selected' : ''}>kg</option>
        <option value="bag" ${item.unit === 'bag' ? 'selected' : ''}>${escapeHtml(lBag)}</option>
      </select>`;
    } else if (product.category === 'carton_box') {
      // Stock tracked as pieces → sell by piece, inner box, or full carton
      unitCell = `<select class="cart-unit-select" data-unit-index="${index}">
        <option value="piece"  ${item.unit === 'piece'  ? 'selected' : ''}>Piece</option>
        <option value="box"    ${item.unit === 'box'    ? 'selected' : ''}>${escapeHtml(lInner)}</option>
        <option value="carton" ${item.unit === 'carton' ? 'selected' : ''}>${escapeHtml(lCtn)}</option>
      </select>`;
    } else if (product.category === 'crate') {
      // Stock tracked as pieces → sell by piece or tray
      unitCell = `<select class="cart-unit-select" data-unit-index="${index}">
        <option value="piece" ${item.unit === 'piece' ? 'selected' : ''}>Piece</option>
        <option value="tray"  ${item.unit === 'tray'  ? 'selected' : ''}>${escapeHtml(lTray)}</option>
      </select>`;
    } else if (product.category === 'dozen') {
      // Stock tracked as pieces → sell by piece or dozen
      unitCell = `<select class="cart-unit-select" data-unit-index="${index}">
        <option value="piece"  ${item.unit === 'piece'  ? 'selected' : ''}>Piece</option>
        <option value="dozen"  ${item.unit === 'dozen'  ? 'selected' : ''}>${escapeHtml(lDoz)}</option>
      </select>`;
    } else {
      // pieces / packet — single unit only
      unitCell = `<span class="cart-unit-label">pc</span>`;
    }

    return `<tr data-cart-index="${index}" class="${hasErr ? 'cart-row-error' : ''}">
      <td class="cart-col-product">
        <strong>${escapeHtml(product.name)}</strong>
        <small>${escapeHtml(sub)}</small>
        ${oversell ? `<span class="cart-stock-error">Max ${escapeHtml(String(maxQtyV))} ${escapeHtml(item.unit)} available</span>` : ''}
        ${!oversell && invalidQty ? '<span class="cart-stock-error">Enter a valid quantity</span>' : ''}
      </td>
      <td class="cart-col-qty">
        <input class="cart-qty${hasErr ? ' input-error' : ''}" data-qty-index="${index}"
          type="number" min="${minQty}" step="${stepQty}" max="${maxQty}" value="${item.qty === null ? '' : escapeHtml(String(item.qty))}"
          aria-label="Quantity">
      </td>
      <td class="cart-col-unit">${unitCell}</td>
      <td class="cart-col-price">
        <input type="number" class="cart-price-input" data-price-index="${index}"
          min="0" step="0.01" value="${escapeHtml(String(unitPrice))}" aria-label="Sell price">
        <small class="price-unit-hint">/${item.unit === 'carton' ? 'ctn' : item.unit === 'dozen' ? 'doz' : item.unit === 'tray' ? 'tray' : item.unit === 'bag' ? 'bag' : item.unit === 'box' ? 'box' : item.unit}</small>
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
      tbody.innerHTML = cart.map((item, i) => cartRowHtml(item, i)).join('');
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
      cart.some((item) => oversellFor(item) || item.qty === null || item.qty < minQtyFor(item));
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

  // Add product button — scroll to and focus the search input
  document.getElementById('add-more-items').addEventListener('click', () => {
    const search = document.getElementById('product-search');
    search.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    search.focus();
  });

  document.getElementById('cancel-sale').addEventListener('click', () => {
    if (!cart.length && !amountPaid && !clientName && !clientPhone) return;
    if (!confirm('Clear this sale?')) return;
    cart.length = 0;
    clientName = '';
    clientPhone = '';
    amountPaid = 0;
    splitCash = 0;
    splitMpesa = 0;
    paymentMode = 'cash';
    document.getElementById('client-name').value = '';
    document.getElementById('client-phone').value = '';
    document.getElementById('product-search').value = '';
    renderCart();
  });

  // Add product to cart
  resultsEl.addEventListener('click', (e) => {
    const button = e.target.closest('[data-add-product]');
    if (!button) return;
    const product = products.find((p) => p.id === button.dataset.addProduct);
    if (!product) return;
    const existing = cart.find((i) => i.product.id === product.id);
    let activeItem;
    if (existing) {
      // Already in cart — just expand it and focus its qty field
      activeItem = existing;
    } else {
      const initUnit = product.category === 'bag' ? 'kg' : 'piece';
      activeItem = {
        product,
        qty:   null,   // blank — cashier types the quantity
        unit:  initUnit,
        price: defaultPrice(product, initUnit),
        collapsed: false,
      };
      cart.push(activeItem);
    }
    cart.forEach((item) => { item.collapsed = item !== activeItem; });
    renderCart();
    // Focus qty field after render so cashier can type immediately
    const idx = cart.indexOf(activeItem);
    tbody.querySelector(`[data-qty-index="${idx}"]`)?.focus();
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

    // Qty edit — targeted update (no full re-render) to preserve focus while typing
    const qtyInput = e.target.closest('[data-qty-index]');
    if (!qtyInput) return;
    const index = Number(qtyInput.dataset.qtyIndex);
    const parsed = parseFloat(qtyInput.value);
    cart[index].qty = qtyInput.value === '' ? null
      : Number.isFinite(parsed) ? parsed : 0;

    const item = cart[index];
    const row  = tbody.querySelector(`tr[data-cart-index="${index}"]`);
    if (row) {
      // Update line total cell
      const totalCell = row.querySelector('.cart-col-total');
      if (totalCell) totalCell.textContent = fmtKES((item.qty ?? 0) * priceFor(item));

      // Update error state
      const oversell   = oversellFor(item);
      const invalidQty = item.qty !== null && item.qty < minQtyFor(item);
      const hasErr     = oversell || invalidQty;
      row.classList.toggle('cart-row-error', hasErr);
      qtyInput.classList.toggle('input-error', hasErr);

      // Update/remove the error hint text below product name
      const productCell = row.querySelector('.cart-col-product');
      let errSpan = productCell?.querySelector('.cart-stock-error');
      if (hasErr) {
        if (!errSpan) {
          errSpan = document.createElement('span');
          errSpan.className = 'cart-stock-error';
          productCell.appendChild(errSpan);
        }
        if (oversell) {
          const avail   = Math.max(availableFor(item), 0);
          const maxV    = maxQtyFor(item.unit, avail, item.product);
          errSpan.textContent = `Max ${maxV} ${item.unit} available`;
        } else {
          errSpan.textContent = 'Enter a valid quantity';
        }
      } else if (errSpan) {
        errSpan.remove();
      }
    }

    document.getElementById('cart-total').textContent = fmtKES(totalForCart());
    renderCheckoutState();
  });

  // Unit dropdown change
  tbody.addEventListener('change', (e) => {
    const unitSel = e.target.closest('[data-unit-index]');
    if (!unitSel) return;
    const index = Number(unitSel.dataset.unitIndex);
    const item = cart[index];
    const newUnit = unitSel.value;
    if (item.unit !== newUnit) {
      item.qty   = null; // clear qty so cashier enters amount in the new unit
      item.unit  = newUnit;
      item.price = defaultPrice(item.product, newUnit);
    }
    renderCart();
    // Focus qty field so cashier can type immediately after switching unit
    tbody.querySelector(`[data-unit-index="${index}"]`)
      ?.closest('tr')
      ?.querySelector(`[data-qty-index="${index}"]`)
      ?.focus();
  });

  // Remove button
  tbody.addEventListener('click', (e) => {
    const removeBtn = e.target.closest('[data-remove-cart]');
    if (!removeBtn) return;
    cart.splice(Number(removeBtn.dataset.removeCart), 1);
    renderCart();
  });

  // Expand a collapsed cart row and focus its quantity.
  tbody.addEventListener('click', (e) => {
    if (e.target.closest('[data-remove-cart]')) return;
    const row = e.target.closest('tr.cart-row-collapsed[data-cart-index]');
    if (!row) return;
    const index = Number(row.dataset.cartIndex);
    cart[index].collapsed = false;
    renderCart();
    tbody.querySelector(`[data-qty-index="${index}"]`)?.focus();
  });

  // ── save sale ──────────────────────────────────────────────────────────────

  document.getElementById('save-sale').addEventListener('click', async (e) => {
    const button = e.currentTarget;
    if (!cart.length || cart.some((item) =>
      oversellFor(item) || item.qty === null || item.qty < minQtyFor(item))) {
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

    const items = cart.map((item) => {
      const cp   = Number(item.product.cost_price || 0);
      const ppc  = Number(item.product.pieces_per_carton || 0);
      const ppb  = piecesPerBox(item.product);
      const ppbt = Number(item.product.pieces_per_box || 0); // pieces per tray
      const bw   = Number(item.product.bag_weight || 0);
      const unitCost = (item.unit === 'carton' || item.unit === 'dozen')
                     ? cp * ppc
                     : item.unit === 'bag'  ? cp * bw
                     : item.unit === 'box'  ? cp * ppb
                     : item.unit === 'tray' ? cp * ppbt
                     : cp; // 'piece' or 'kg'
      return {
        product_id: item.product.id,
        qty:        item.qty,
        unit_sold:  item.unit, // 'piece'|'carton'|'kg'|'bag'|'box'
        unit_price: priceFor(item),
        unit_cost:  unitCost,
      };
    });
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
      unit_sold: item.product.category === 'bag' ? item.unit
        : ['carton', 'carton_box', 'crate', 'dozen'].includes(item.product.category) ? item.unit
        : 'piece',
      unit_price: priceFor(item),
      line_total: (item.qty ?? 0) * priceFor(item),
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
