import { saveReceipt, getProducts } from '../services/products.js';
import { getSuppliers } from '../services/suppliers.js';
import { showToast } from '../components/toast.js';
import { fmtKES, today } from '../utils.js';

// ── Module-level state ────────────────────────────────────────────────────────
let _rowCounter = 0;
let _activeCleanup = null;

// ── Row model ─────────────────────────────────────────────────────────────────
// cost   = per carton (carton type) | per unit (all other types)
// sell   = per piece (carton type) | per unit (all other types)
// sellC  = per carton (carton type only, bidirectional with sell)
function mkRow(overrides = {}) {
  return {
    id: String(++_rowCounter),
    type: 'pieces',
    name: '',
    qty: '',
    ppc: '',          // pieces per carton (carton only)
    size_value: '',
    size_unit: 'g',
    cost: '',         // cost/carton for carton; cost/unit for others
    sell: '',         // sell/piece for carton; sell/unit for others
    sellC: '',        // sell/carton for carton only (bidirectional with sell)
    ...overrides,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function escapeHtml(v) {
  return String(v ?? '').replace(/[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const positive = (v) => Number.isFinite(Number(v)) && Number(v) > 0;
const fmt2 = (n) => (Math.round(n * 100) / 100).toFixed(2);
const numberDisplay = (v) => Number(v || 0).toLocaleString('en-KE', { maximumFractionDigits: 3 });

function lineTotal(row) {
  const qty = Number(row.qty) || 0;
  const cost = Number(row.cost) || 0;
  if (!qty || !cost) return 0;
  if (row.type === 'bag') return cost;       // cost = total bag cost already
  if (row.type === 'carton') return qty * cost; // qty=cartons, cost=per carton
  return qty * cost;
}

function profitHtml(row) {
  const cost = Number(row.cost) || 0;
  const sell = Number(row.sell) || 0;
  if (!cost || !sell) return '';
  let profitPerUnit, pctBase, label;
  if (row.type === 'carton') {
    const ppc = Number(row.ppc) || 0;
    if (!ppc) return '';
    const costPc = cost / ppc;
    profitPerUnit = sell - costPc;
    pctBase = costPc;
    label = '/pc';
  } else if (row.type === 'bag') {
    const qty = Number(row.qty) || 0;
    if (!qty) return '';
    const costKg = cost / qty;
    profitPerUnit = sell - costKg;
    pctBase = costKg;
    label = '/kg';
  } else {
    profitPerUnit = sell - cost;
    pctBase = cost;
    label = '';
  }
  const pct = pctBase > 0 ? (profitPerUnit / pctBase * 100).toFixed(1) : '0.0';
  const cls = profitPerUnit >= 0 ? 'profit-pos' : 'profit-neg';
  return `<span class="${cls}">${fmtKES(profitPerUnit)}${label} (${pct}%)</span>`;
}

function isRowEmpty(row) {
  return !row.name.trim() && !row.qty && !row.cost && !row.sell;
}

function validateRow(row) {
  if (isRowEmpty(row)) return null;
  if (!row.name.trim()) return 'Enter a product name.';
  if (!positive(row.qty)) return `Enter qty for "${row.name}".`;
  if (row.type === 'carton' && !positive(row.ppc))
    return `Enter pieces per carton for "${row.name}".`;
  if (!positive(row.cost)) return `Enter cost for "${row.name}".`;
  if (!positive(row.sell)) return `Enter sell price for "${row.name}".`;
  return null;
}

function buildPayloadItem(row) {
  const sv = row.size_value !== '' ? Number(row.size_value) : null;
  const su = sv != null ? row.size_unit : null;
  const qty = Number(row.qty);
  const cost = Number(row.cost);
  const sell = Number(row.sell);
  const base = { name: row.name.trim(), size_value: sv, size_unit: su };

  if (row.type === 'pieces') {
    return { ...base, category: 'pieces', cost_price: cost, sell_price: sell, stock_qty: qty };
  }
  if (row.type === 'carton') {
    const ppc = Number(row.ppc);
    const costPerPiece = cost / ppc;  // products.cost_price must be per piece — products page computes sell - cost
    const sellCtn = Number(row.sellC) || sell * ppc;
    return { ...base, category: 'carton', pieces_per_carton: ppc,
      cost_price: costPerPiece,   // per piece
      sell_price: sell,           // sell per piece
      carton_sell_price: sellCtn,
      stock_qty: qty * ppc };     // total pieces in stock
  }
  if (row.type === 'bag') {
    const costPerKg = cost / qty;   // cost = total bag cost; qty = total kg → cost/kg
    return { ...base, category: 'bag',
      cost_price: costPerKg,      // per kg
      sell_price: sell,           // per kg
      stock_qty: qty };           // total kg
  }
  return null;
}

// ── Row HTML ──────────────────────────────────────────────────────────────────
// Column order: Name | Type | Qty | Pcs/ctn | Size | Cost | Cost/pc | Sell/pc | Sell/ctn | Profit | ×
function renderRowHtml(row) {
  const ev = escapeHtml;
  const attr = (x) => (x !== '' && x != null) ? ` value="${ev(x)}"` : '';
  const isCarton = row.type === 'carton';
  const isBag    = row.type === 'bag';

  const typeOpts = ['pieces', 'carton', 'bag']
    .map((t) => `<option value="${t}"${row.type === t ? ' selected' : ''}>${t.charAt(0).toUpperCase() + t.slice(1)}</option>`)
    .join('');
  const unitOpts = ['g', 'kg', 'ml', 'L']
    .map((u) => `<option value="${u}"${row.size_unit === u ? ' selected' : ''}>${u}</option>`)
    .join('');

  // Qty label
  const qtyLabel = isCarton ? 'Cartons' : isBag ? 'Kg' : 'Pieces';

  // Pcs/ctn column (carton only)
  const ppcCell = isCarton
    ? `<td class="col-ppc" data-label="Pcs/ctn">
        <input type="number" name="ppc" min="1" step="1"${attr(row.ppc)} placeholder="0" aria-label="Pieces per carton">
       </td>`
    : `<td class="col-ppc col-dim" data-label="Pcs/ctn"><span class="dim-dash">—</span></td>`;

  // Cost column label
  const costLabel = isCarton ? 'Cost/ctn' : isBag ? 'Total cost' : 'Cost/pc';

  // Cost/pc or Cost/kg — auto-filled for carton and bag
  const ppc = Number(row.ppc) || 0;
  let costPcCell = '';
  if (isCarton) {
    const costPcVal = ppc && row.cost !== '' ? fmt2(Number(row.cost) / ppc) : '';
    costPcCell = `<td class="col-cost-pc" data-label="Cost/pc">
      <small class="cell-hint">Cost/pc</small>
      <input type="number" name="cost_pc" class="auto-field" readonly tabindex="-1"${costPcVal ? ` value="${ev(costPcVal)}"` : ''} placeholder="—" aria-label="Cost per piece (auto)">
    </td>`;
  } else if (isBag) {
    const qty = Number(row.qty) || 0;
    const costKgVal = qty && row.cost !== '' ? fmt2(Number(row.cost) / qty) : '';
    costPcCell = `<td class="col-cost-pc" data-label="Cost/kg">
      <small class="cell-hint">Cost/kg</small>
      <input type="number" name="cost_pc" class="auto-field" readonly tabindex="-1"${costKgVal ? ` value="${ev(costKgVal)}"` : ''} placeholder="—" aria-label="Cost per kg (auto)">
    </td>`;
  } else {
    costPcCell = `<td class="col-cost-pc col-dim" data-label="Cost/pc"><span class="dim-dash">—</span></td>`;
  }

  // Sell label
  const sellPcLabel = isCarton ? 'Sell/pc' : isBag ? 'Sell/kg' : 'Sell/pc';

  // Sell/ctn column (carton only)
  let sellCtnCell = '';
  if (isCarton) {
    sellCtnCell = `<td class="col-sell-ctn" data-label="Sell/ctn">
      <input type="number" name="sellC" min="0.01" step="0.01"${attr(row.sellC)} placeholder="0.00" aria-label="Sell price per carton">
    </td>`;
  } else {
    sellCtnCell = `<td class="col-sell-ctn col-dim" data-label="Sell/ctn"><span class="dim-dash">—</span></td>`;
  }

  return `<tr data-row-id="${ev(row.id)}" data-type="${ev(row.type)}">
    <td class="col-name" data-label="Name">
      <input type="text" name="name" placeholder="Product name" autocomplete="off"${attr(row.name)}>
    </td>
    <td class="col-type" data-label="Type">
      <select name="type" aria-label="Type">${typeOpts}</select>
    </td>
    <td class="col-qty" data-label="${ev(qtyLabel)}">
      <small class="cell-hint">${ev(qtyLabel)}</small>
      <input type="number" name="qty" min="0.001" step="any"${attr(row.qty)} placeholder="0" aria-label="${ev(qtyLabel)}">
    </td>
    ${ppcCell}
    ${isBag
      ? `<td class="col-size col-dim" data-label="Size"><span class="dim-dash">—</span></td>`
      : `<td class="col-size" data-label="${isCarton ? 'Piece size' : 'Size'}">
           <div class="size-pair">
             <input type="number" name="size_value" min="0.001" step="any"${attr(row.size_value)} placeholder="—" aria-label="${isCarton ? 'Piece size' : 'Size'}">
             <select name="size_unit" aria-label="Unit">${unitOpts}</select>
           </div>
         </td>`
    }
    <td class="col-cost" data-label="${ev(costLabel)}">
      <small class="cell-hint">${ev(costLabel)}</small>
      <input type="number" name="cost" min="0.01" step="0.01"${attr(row.cost)} placeholder="0.00" aria-label="${ev(costLabel)}">
    </td>
    ${costPcCell}
    <td class="col-sell" data-label="${ev(sellPcLabel)}">
      <small class="cell-hint">${ev(sellPcLabel)}</small>
      <input type="number" name="sell" min="0.01" step="0.01"${attr(row.sell)} placeholder="0.00" aria-label="${ev(sellPcLabel)}">
    </td>
    ${sellCtnCell}
    <td class="col-profit" data-label="Profit">${profitHtml(row)}</td>
    <td class="col-remove"><button type="button" class="btn-row-remove" tabindex="-1" aria-label="Remove row">×</button></td>
  </tr>`;
}

// ── Page ──────────────────────────────────────────────────────────────────────
export async function renderStockIn() {
  if (_activeCleanup) { _activeCleanup(); _activeCleanup = null; }

  const app = document.getElementById('app');
  app.innerHTML = '<p>Loading…</p>';

  const [{ data: suppliers, error: suppliersError }, { data: existingProducts }] = await Promise.all([
    getSuppliers(),
    getProducts(),
  ]);
  if (suppliersError) {
    app.innerHTML = '<p class="error">Failed to load suppliers.</p>';
    return;
  }

  const rows = [mkRow()];

  app.innerHTML = `
    <div class="stock-in-page">
      <div class="stock-in-titlebar">
        <h1>Stock In</h1>
        <div class="stock-in-header">
          <label>Supplier name *
            <input id="supplier-name" type="text" list="supplier-list" autocomplete="off" placeholder="Required">
            <datalist id="supplier-list">${(suppliers ?? []).map((s) => `<option value="${escapeHtml(s.name)}"></option>`).join('')}</datalist>
          </label>
          <label>Supplier phone<input id="supplier-phone" type="tel" placeholder="optional"></label>
          <label>Date<input id="receipt-date" type="date" value="${today()}"></label>
          <label>Reference / note<input id="receipt-note" type="text"></label>
        </div>
      </div>

      <div class="receipt-table-wrap">
        <table class="receipt-table">
          <colgroup>
            <col class="col-name">
            <col class="col-type">
            <col class="col-qty">
            <col class="col-ppc">
            <col class="col-size">
            <col class="col-cost">
            <col class="col-cost-pc">
            <col class="col-sell">
            <col class="col-sell-ctn">
            <col class="col-profit">
            <col class="col-remove">
          </colgroup>
          <thead>
            <tr>
              <th>Product name</th>
              <th>Type</th>
              <th>Qty</th>
              <th>Pcs/ctn</th>
              <th>Piece size</th>
              <th>Cost</th>
              <th>Cost/unit</th>
              <th>Sell</th>
              <th>Sell/ctn</th>
              <th>Profit</th>
              <th></th>
            </tr>
          </thead>
          <tbody id="receipt-tbody"></tbody>
        </table>
      </div>

      <div class="receipt-footer">
        <button id="add-row" class="btn btn-ghost" type="button">+ Add another product</button>
        <div class="receipt-footer-right">
          <span class="receipt-total-label">Receipt total: <strong id="receipt-total">KES 0</strong></span>
          <p id="save-error" class="error hidden" role="alert"></p>
          <button id="save-receipt" class="btn btn-green" type="button">Save Receipt</button>
        </div>
      </div>
    </div>`;

  const tbody = document.getElementById('receipt-tbody');

  // ── Existing product match ───────────────────────────────────────────────

  function findExisting(row) {
    if (!row.name.trim() || !existingProducts) return null;
    return existingProducts.find((p) =>
      p.name.toLowerCase() === row.name.trim().toLowerCase() &&
      p.category === row.type
    ) ?? null;
  }

  function updateExistingNotice(row) {
    const tr = tbody.querySelector(`tr[data-row-id="${row.id}"]`);
    if (!tr) return;
    let notice = tr.querySelector('.row-existing-notice');
    const match = findExisting(row);
    if (match) {
      const stockUnit = match.category === 'bag' ? 'kg' : 'pcs';
      if (!notice) {
        notice = document.createElement('p');
        notice.className = 'row-existing-notice';
        tr.querySelector('.col-name').appendChild(notice);
      }
      notice.textContent = `⟳ Already in stock (${numberDisplay(match.stock_qty)} ${stockUnit}) — will be combined. This supplier gets their own receipt.`;
    } else if (notice) {
      notice.remove();
    }
  }

  // ── DOM helpers ──────────────────────────────────────────────────────────

  function renderTbody() {
    tbody.innerHTML = rows.map(renderRowHtml).join('');
  }

  function replaceRowDom(row) {
    const tr = tbody.querySelector(`tr[data-row-id="${row.id}"]`);
    if (!tr) return;
    const tmp = document.createElement('tbody');
    tmp.innerHTML = renderRowHtml(row);
    tr.replaceWith(tmp.firstElementChild);
  }

  // Update derived read-only cells without disturbing focus
  function updateDerived(row) {
    const tr = tbody.querySelector(`tr[data-row-id="${row.id}"]`);
    if (!tr) return;

    updateExistingNotice(row);

    // Profit
    tr.querySelector('.col-profit').innerHTML = profitHtml(row);

    // Cost/pc or Cost/kg (auto-filled)
    const costPcInput = tr.querySelector('[name="cost_pc"]');
    if (costPcInput) {
      if (row.type === 'carton') {
        const ppc = Number(row.ppc) || 0;
        const cost = Number(row.cost) || 0;
        costPcInput.value = ppc && cost ? fmt2(cost / ppc) : '';
      } else if (row.type === 'bag') {
        const qty = Number(row.qty) || 0;
        const cost = Number(row.cost) || 0;
        costPcInput.value = qty && cost ? fmt2(cost / qty) : '';
      }
    }
  }

  function updateFooter() {
    const total = rows.reduce((s, r) => s + lineTotal(r), 0);
    document.getElementById('receipt-total').textContent = fmtKES(total);
    const count = rows.filter((r) => !isRowEmpty(r)).length;
    const btn = document.getElementById('save-receipt');
    if (btn) btn.textContent = count > 0 ? `Save Receipt (${count} item${count > 1 ? 's' : ''})` : 'Save Receipt';
  }

  function checkDuplicates() {
    tbody.querySelectorAll('.row-dup').forEach((tr) => tr.classList.remove('row-dup'));
    const seen = new Map();
    rows.forEach((row) => {
      if (isRowEmpty(row) || !row.name.trim()) return;
      const key = `${row.name.trim().toLowerCase()}|${row.type}|${row.size_value ?? ''}|${row.size_unit}`;
      if (!seen.has(key)) seen.set(key, []);
      seen.get(key).push(row.id);
    });
    seen.forEach((ids) => {
      if (ids.length > 1) ids.forEach((id) => tbody.querySelector(`tr[data-row-id="${id}"]`)?.classList.add('row-dup'));
    });
  }

  function clearErrors() {
    tbody.querySelectorAll('.row-error').forEach((tr) => tr.classList.remove('row-error'));
    const el = document.getElementById('save-error');
    if (el) { el.textContent = ''; el.classList.add('hidden'); }
  }

  function appendRow() {
    rows.push(mkRow());
    const tmp = document.createElement('tbody');
    tmp.innerHTML = renderRowHtml(rows.at(-1));
    tbody.appendChild(tmp.firstElementChild);
    updateFooter();
  }

  // ── Initial render ───────────────────────────────────────────────────────
  renderTbody();
  updateFooter();

  // ── tbody: change (selects) ──────────────────────────────────────────────
  tbody.addEventListener('change', (e) => {
    const tr = e.target.closest('tr[data-row-id]');
    if (!tr) return;
    const row = rows.find((r) => r.id === tr.dataset.rowId);
    if (!row || !e.target.name) return;
    row[e.target.name] = e.target.value;

    if (e.target.name === 'type') {
      // Full re-render — labels and extra columns change
      replaceRowDom(row);
      updateExistingNotice(row);
      tbody.querySelector(`tr[data-row-id="${row.id}"] [name="qty"]`)?.focus();
    } else {
      updateDerived(row);
    }
    clearErrors();
    updateFooter();
    checkDuplicates();
  });

  // ── tbody: input (number + text fields) ─────────────────────────────────
  tbody.addEventListener('input', (e) => {
    const tr = e.target.closest('tr[data-row-id]');
    if (!tr) return;
    const row = rows.find((r) => r.id === tr.dataset.rowId);
    if (!row || !e.target.name) return;
    if (e.target.name === 'type' || e.target.name === 'size_unit') return;

    row[e.target.name] = e.target.value;

    // ── Bidirectional sell/pc ↔ sell/ctn (carton) ──
    if (row.type === 'carton') {
      const ppc = Number(row.ppc) || 0;
      if (e.target.name === 'sell' && ppc) {
        const newSellC = fmt2(Number(row.sell) * ppc);
        row.sellC = newSellC;
        const sellCInput = tr.querySelector('[name="sellC"]');
        if (sellCInput && document.activeElement !== sellCInput) sellCInput.value = newSellC;
      }
      if (e.target.name === 'sellC' && ppc) {
        const newSell = fmt2(Number(row.sellC) / ppc);
        row.sell = newSell;
        const sellInput = tr.querySelector('[name="sell"]');
        if (sellInput && document.activeElement !== sellInput) sellInput.value = newSell;
      }
      // Recalculate sell/ctn when ppc changes (if sell/pc already filled)
      if (e.target.name === 'ppc' && ppc && row.sell) {
        const newSellC = fmt2(Number(row.sell) * ppc);
        row.sellC = newSellC;
        const sellCInput = tr.querySelector('[name="sellC"]');
        if (sellCInput) sellCInput.value = newSellC;
      }
    }

    updateDerived(row);
    clearErrors();
    updateFooter();
    checkDuplicates();
  });

  // ── tbody: remove button ─────────────────────────────────────────────────
  tbody.addEventListener('click', (e) => {
    const btn = e.target.closest('.btn-row-remove');
    if (!btn) return;
    const tr = btn.closest('tr[data-row-id]');
    if (!tr) return;
    const index = rows.findIndex((r) => r.id === tr.dataset.rowId);
    if (index === -1) return;
    if (rows.length === 1) {
      rows[0] = mkRow();
      renderTbody();
    } else {
      rows.splice(index, 1);
      tr.remove();
    }
    updateFooter();
    checkDuplicates();
  });

  // ── tbody: Enter key navigation ──────────────────────────────────────────
  tbody.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const active = document.activeElement;
    if (!active || !tbody.contains(active)) return;
    e.preventDefault();
    // Skip readonly auto-fields in Tab order
    const allFields = [...tbody.querySelectorAll('input:not([readonly]), select')];
    const idx = allFields.indexOf(active);
    if (idx === -1) return;
    if (idx < allFields.length - 1) {
      allFields[idx + 1].focus();
    } else {
      appendRow();
      tbody.querySelector('tr:last-child [name="name"]')?.focus();
    }
  });

  // ── Add row button ───────────────────────────────────────────────────────
  document.getElementById('add-row').addEventListener('click', () => {
    appendRow();
    tbody.querySelector('tr:last-child [name="name"]')?.focus();
  });

  // ── Save ─────────────────────────────────────────────────────────────────
  document.getElementById('save-receipt').addEventListener('click', async () => {
    clearErrors();
    const saveError = document.getElementById('save-error');
    const btn = document.getElementById('save-receipt');

    const supplierName = document.getElementById('supplier-name').value.trim();
    if (!supplierName) {
      saveError.textContent = 'Enter a supplier name.';
      saveError.classList.remove('hidden');
      document.getElementById('supplier-name').focus();
      return;
    }

    let firstError = null;
    rows.forEach((row) => {
      const err = validateRow(row);
      if (err) {
        tbody.querySelector(`tr[data-row-id="${row.id}"]`)?.classList.add('row-error');
        if (!firstError) firstError = err;
      }
    });
    if (firstError) {
      saveError.textContent = firstError;
      saveError.classList.remove('hidden');
      tbody.querySelector('.row-error input:not([readonly])')?.focus();
      return;
    }

    const validRows = rows.filter((r) => !isRowEmpty(r));
    if (!validRows.length) {
      saveError.textContent = 'Add at least one product.';
      saveError.classList.remove('hidden');
      return;
    }

    // Sell < cost confirm per row
    for (const row of validRows) {
      const costPc = row.type === 'carton' && Number(row.ppc)
        ? Number(row.cost) / Number(row.ppc)
        : row.type === 'bag' && Number(row.qty)
        ? Number(row.cost) / Number(row.qty)
        : Number(row.cost);
      if (Number(row.sell) < costPc) {
        if (!confirm(`"${row.name}": sell (${fmtKES(Number(row.sell))}) is below cost/pc (${fmtKES(costPc)}). Continue?`)) {
          tbody.querySelector(`tr[data-row-id="${row.id}"]`)?.classList.add('row-error');
          return;
        }
      }
    }

    // Duplicate SKU confirm
    const dupKeys = new Map();
    for (const row of validRows) {
      const key = `${row.name.trim().toLowerCase()}|${row.type}|${row.size_value ?? ''}|${row.size_unit}`;
      if (dupKeys.has(key)) {
        if (!confirm(`Duplicate rows found for "${row.name}" (${row.type}). Merge and save?`)) return;
        break;
      }
      dupKeys.set(key, true);
    }

    const items = validRows.map(buildPayloadItem).filter(Boolean);
    const savedCount = items.length;
    const savedTotal = validRows.reduce((s, r) => s + lineTotal(r), 0);

    btn.disabled = true;
    btn.textContent = 'Saving…';

    const { error } = await saveReceipt(
      supplierName,
      document.getElementById('supplier-phone').value.trim(),
      document.getElementById('receipt-date').value,
      document.getElementById('receipt-note').value.trim(),
      items,
    );

    if (error) {
      saveError.textContent = error.message || 'Failed to save. Check your connection and try again.';
      saveError.classList.remove('hidden');
      btn.disabled = false;
      updateFooter();
      return;
    }

    cleanup();
    rows.length = 0;
    rows.push(mkRow());
    renderTbody();
    document.getElementById('supplier-name').value = '';
    document.getElementById('supplier-phone').value = '';
    document.getElementById('receipt-date').value = today();
    document.getElementById('receipt-note').value = '';
    btn.disabled = false;
    updateFooter();

    const wrap = document.querySelector('.receipt-table-wrap');
    const banner = document.createElement('div');
    banner.className = 'save-success';
    banner.innerHTML = `<p class="save-success-title">Receipt saved</p>
      <p>${savedCount} item${savedCount > 1 ? 's' : ''} added to stock — total cost ${fmtKES(savedTotal)}</p>
      <a href="#/products">View products →</a>`;
    wrap.before(banner);
    window.setTimeout(() => banner.remove(), 8000);
  });

  // ── Nav guards ────────────────────────────────────────────────────────────
  const hasData = () => rows.some((r) => !isRowEmpty(r));
  const warnMsg = () => `You have unsaved products in the receipt.\n\nLeave and lose your data?`;

  const sidebarGuard = (e) => {
    const link = e.target.closest('a[data-route]');
    if (!link || link.getAttribute('data-route') === '#/stock-in') return;
    if (!hasData()) return;
    if (!confirm(warnMsg())) e.preventDefault();
  };

  const hashGuard = () => {
    if (location.hash === '#/stock-in') return;
    if (!hasData()) { cleanup(); return; }
    if (!confirm(warnMsg())) {
      window.removeEventListener('hashchange', hashGuard);
      location.hash = '#/stock-in';
      window.addEventListener('hashchange', hashGuard);
    } else {
      cleanup();
    }
  };

  const beforeUnloadGuard = (e) => {
    if (!hasData()) return;
    e.preventDefault();
    e.returnValue = '';
  };

  function cleanup() {
    document.getElementById('sidebar')?.removeEventListener('click', sidebarGuard);
    window.removeEventListener('hashchange', hashGuard);
    window.removeEventListener('beforeunload', beforeUnloadGuard);
    if (_activeCleanup === cleanup) _activeCleanup = null;
  }
  _activeCleanup = cleanup;

  document.getElementById('sidebar')?.addEventListener('click', sidebarGuard);
  window.addEventListener('hashchange', hashGuard);
  window.addEventListener('beforeunload', beforeUnloadGuard);
}
