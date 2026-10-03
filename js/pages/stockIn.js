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
    bpc: '',          // boxes per carton (carton_box only)
    ppb: '',          // pieces per box (carton_box only)
    ppt: '',          // pieces per tray (crate/tray only)
    bagSize: '',      // weight or volume per bag (bag only)
    size_value: '',
    size_unit: 'g',
    cost: '',         // cost/carton for carton; cost/tray for crate; cost/unit for others
    costKg: '',       // cost/kg or cost/L (bag only)
    costBox: '',      // cost per box (carton_box only)
    costPc: '',       // cost per piece (carton_box only)
    sell: '',         // sell/piece for carton/crate; sell/unit for others
    sellC: '',        // sell/carton for carton only (bidirectional with sell)
    sellBox: '',      // sell per box (carton_box only)
    sellTray: '',     // sell per tray (crate only, bidirectional with sell)
    sellB: '',        // sell/bag for bag only (bidirectional with sell)
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
function bagBaseUnit(row) {
  return row.size_unit === 'kg' || row.size_unit === 'g' ? 'kg' : 'L';
}
function bagBase(row) {
  const size = Number(row.bagSize || 0);
  return row.size_unit === 'g' || row.size_unit === 'ml' ? size / 1000 : size;
}

function lineTotal(row) {
  const qty = Number(row.qty) || 0;
  const cost = Number(row.cost) || 0;
  if (!qty || !cost) return 0;
  if (row.type === 'bag') return qty * cost;
  if (row.type === 'carton') return qty * cost; // qty=cartons, cost=per carton
  return qty * cost;
}

function profitHtml(row) {
  const cost = Number(row.cost) || 0;
  const sell = Number(row.sell) || 0;
  if (!cost || !sell) return '';
  let profitPerUnit, pctBase, label;
  if (row.type === 'carton_box') {
    const ppc = Number(row.bpc) * Number(row.ppb);
    if (!(ppc > 0)) return '';
    const costPc = cost / ppc;
    profitPerUnit = sell - costPc;
    pctBase = costPc;
    label = '/pc';
  } else if (row.type === 'crate') {
    const ppt = Number(row.ppt);
    if (!(ppt > 0)) return '';
    const costPc = cost / ppt;
    profitPerUnit = sell - costPc;
    pctBase = costPc;
    label = '/pc';
  } else if (row.type === 'carton' || row.type === 'dozen') {
    const ppc = Number(row.ppc) || 0;
    if (!ppc) return '';
    const costPc = cost / ppc;
    profitPerUnit = sell - costPc;
    pctBase = costPc;
    label = '/pc';
  } else if (row.type === 'bag') {
    const bagSize = bagBase(row);
    if (bagSize <= 0) return '';
    const costPerUnit = Number(row.cost) / bagSize;
    profitPerUnit = sell - costPerUnit;
    pctBase = costPerUnit;
    label = `/${bagBaseUnit(row)}`;
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
  return !row.name.trim() && !row.qty && !row.cost && !row.sell &&
    (row.type !== 'bag' || (!row.bagSize && !row.costKg && !row.sellB)) &&
    (row.type !== 'carton_box' || (!row.bpc && !row.ppb && !row.costBox && !row.costPc && !row.sellBox)) &&
    (row.type !== 'crate'      || (!row.ppt && !row.sellTray)) &&
    (row.type !== 'dozen'      || !row.ppc);
}

function validateRow(row) {
  if (isRowEmpty(row)) return null;
  if (!row.name.trim()) return 'Enter a product name.';
  if (row.type === 'carton_box' && !positive(row.qty))
    return `Enter number of cartons for "${row.name}".`;
  if (!positive(row.qty)) return row.type === 'bag'
    ? `Enter number of bags for "${row.name}".`
    : `Enter qty for "${row.name}".`;
  if (row.type === 'carton' && !positive(row.ppc))
    return `Enter pieces per carton for "${row.name}".`;
  if (row.type === 'carton_box' && !positive(row.bpc))
    return `Enter boxes per carton for "${row.name}".`;
  if (row.type === 'carton_box' && !positive(row.ppb))
    return `Enter pieces per box for "${row.name}".`;
  if (row.type === 'dozen' && !positive(row.ppc))
    return `Enter pieces per dozen for "${row.name}".`;
  if (row.type === 'crate' && !positive(row.ppt))
    return `Enter pieces per tray for "${row.name}".`;
  if (row.type === 'bag' && !positive(row.bagSize))
    return `Enter size per bag for "${row.name}".`;
  if (row.type === 'bag' && !positive(row.cost))
    return `Enter cost per bag for "${row.name}".`;
  if (row.type === 'bag' && !positive(row.sell))
    return `Enter sell price per ${bagBaseUnit(row)} for "${row.name}".`;
  if (row.type === 'carton_box' && !positive(row.cost))
    return `Enter cost per carton for "${row.name}".`;
  if (row.type === 'carton_box' && !positive(row.sell))
    return `Enter sell price per piece for "${row.name}".`;
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
  if (row.type === 'carton_box') {
    const bpc = Number(row.bpc);
    const ppb = Number(row.ppb);
    const ppc = bpc * ppb;
    return { ...base, category: 'carton_box', packets_per_box: bpc,
      pieces_per_box: ppb, pieces_per_carton: ppc,
      cost_price: cost / ppc,
      sell_price: sell,
      box_sell_price: Number(row.sellBox) || sell * ppb,
      carton_sell_price: Number(row.sellC) || sell * ppc,
      stock_qty: qty * ppc };
  }
  if (row.type === 'bag') {
    const bagSize = bagBase(row);
    const costPerKg = cost / bagSize;
    return { ...base, category: 'bag', size_value: null, size_unit: bagBaseUnit(row),
      bag_weight: bagSize,
      cost_price: costPerKg,
      sell_price: sell,
      bag_sell_price: Number(row.sellB) || sell * bagSize,
      stock_qty: qty * bagSize };
  }
  if (row.type === 'dozen') {
    const ppc = Number(row.ppc);
    const costPerPiece = Number(row.cost) / ppc;
    const sellDz = Number(row.sellC) || Number(row.sell) * ppc;
    return { ...base, category: 'dozen', pieces_per_carton: ppc,
      cost_price: costPerPiece,
      sell_price: Number(row.sell),
      carton_sell_price: sellDz,
      stock_qty: Number(row.qty) * ppc };
  }
  if (row.type === 'crate') {
    const ppt         = Number(row.ppt);
    const costPerPiece = Number(row.cost) / ppt;
    const sellTrayVal  = Number(row.sellTray) || Number(row.sell) * ppt;
    return { ...base, category: 'crate',
      pieces_per_box:    ppt,
      pieces_per_carton: ppt,
      cost_price:        costPerPiece,
      sell_price:        Number(row.sell),
      box_sell_price:    sellTrayVal,
      carton_sell_price: sellTrayVal,
      stock_qty:         Number(row.qty) * ppt };
  }
  return null;
}

// ── Row HTML ──────────────────────────────────────────────────────────────────
function renderRowHtml(row) {
  const ev = escapeHtml;
  const attr = (x) => (x !== '' && x != null) ? ` value="${ev(x)}"` : '';
  const isCarton    = row.type === 'carton';
  const isCartonBox = row.type === 'carton_box';
  const isBag       = row.type === 'bag';
  const isCrate     = row.type === 'crate';
  const isDozen     = row.type === 'dozen';

  const typeOpts = [
    ['pieces', 'Pieces'],
    ['carton', 'Carton'],
    ['dozen', 'Dozen'],
    ['bag', 'Bag'],
    ['carton_box', 'Carton + boxes'],
    ['crate', 'Tray'],
  ].map(([val, label]) => `<option value="${val}"${row.type === val ? ' selected' : ''}>${ev(label)}</option>`).join('');

  const unitOpts = ['g', 'kg', 'ml', 'L']
    .map((u) => `<option value="${u}"${row.size_unit === u ? ' selected' : ''}>${u}</option>`)
    .join('');

  const qtyLabel = isCrate ? 'Trays'
    : isCarton || isCartonBox ? 'Cartons'
    : isDozen ? 'Dozens'
    : isBag ? 'Bags'
    : 'Pieces';

  const field = (label, control, widthClass = '') => `<label class="row-card-field${widthClass ? ` ${widthClass}` : ''}"><small class="cell-hint">${ev(label)}</small>${control}</label>`;
  const qtyField = field(qtyLabel, `<input type="number" name="qty" min="0.001" step="any"${attr(row.qty)} placeholder="0" aria-label="${ev(qtyLabel)}">`);
  const pieceSizeFields = field('Piece size', `<div class="size-pair">
    <input type="number" name="size_value" min="0.001" step="any"${attr(row.size_value)} placeholder="—" aria-label="${isCarton ? 'Piece size' : 'Size'}">
    <select name="size_unit" aria-label="Unit">${unitOpts}</select>
  </div>`, 'row-card-field-size');
  const bagSizeFields = field('Size/bag', `<div class="size-pair">
    <input type="number" name="bagSize" min="0.001" step="any"${attr(row.bagSize)} placeholder="0" aria-label="Size per bag">
    <select name="size_unit" aria-label="Bag unit">
      <option value="kg"${row.size_unit === 'kg' ? ' selected' : ''}>kg</option>
      <option value="g"${row.size_unit === 'g' ? ' selected' : ''}>g</option>
      <option value="L"${row.size_unit === 'L' ? ' selected' : ''}>L</option>
      <option value="ml"${row.size_unit === 'ml' ? ' selected' : ''}>ml</option>
    </select>
  </div>`, 'row-card-field-size');

  let receivedFields;
  if (isBag) {
    receivedFields = `${qtyField}${bagSizeFields}`;
  } else if (isCartonBox) {
    receivedFields = `${qtyField}${field('Boxes/ctn', `<input type="number" name="bpc" min="1" step="1"${attr(row.bpc)} placeholder="0" aria-label="Boxes per carton">`, 'row-card-field-narrow')}${field('Pcs/box', `<input type="number" name="ppb" min="1" step="1"${attr(row.ppb)} placeholder="0" aria-label="Pieces per box">`, 'row-card-field-narrow')}${pieceSizeFields}`;
  } else if (isCrate) {
    receivedFields = `${qtyField}${field('Pcs/tray', `<input type="number" name="ppt" min="1" step="1"${attr(row.ppt)} placeholder="0" aria-label="Pieces per tray">`, 'row-card-field-narrow')}${pieceSizeFields}`;
  } else if (isCarton) {
    receivedFields = `${qtyField}${field('Pcs/carton', `<input type="number" name="ppc" min="1" step="1"${attr(row.ppc)} placeholder="0" aria-label="Pieces per carton">`, 'row-card-field-narrow')}${pieceSizeFields}`;
  } else if (isDozen) {
    receivedFields = `${qtyField}${field('Pcs/dozen', `<input type="number" name="ppc" min="1" step="1"${attr(row.ppc)} placeholder="12" aria-label="Pieces per dozen">`, 'row-card-field-narrow')}${pieceSizeFields}`;
  } else {
    receivedFields = `${qtyField}${pieceSizeFields}`;
  }

  const ppc = Number(row.ppc) || 0;
  const costLabel = isCrate ? 'Cost/tray'
    : isCarton || isCartonBox ? 'Cost/ctn'
    : isDozen ? 'Cost/dozen'
    : isBag ? 'Cost/bag'
    : 'Cost/pc';
  let costFields = field(costLabel, `<input type="number" name="cost" min="0.01" step="0.01"${attr(row.cost)} placeholder="0.00" aria-label="${ev(costLabel)}">`);
  if (isCarton || isDozen) {
    const costPcVal = ppc && row.cost !== '' ? fmt2(Number(row.cost) / ppc) : '';
    costFields += field('Cost/pc', `<input type="number" name="cost_pc" class="auto-field" readonly tabindex="-1"${costPcVal ? ` value="${ev(costPcVal)}"` : ''} placeholder="—" aria-label="Cost per piece (auto)">`);
  } else if (isBag) {
    const costUnit = bagBaseUnit(row);
    costFields += field(`Cost/${costUnit}`, `<input type="number" name="costKg" min="0.01" step="0.01"${attr(row.costKg)} placeholder="0.00" aria-label="Cost per ${costUnit}">`);
  } else if (isCartonBox) {
    costFields += field('Cost/box', `<input type="number" name="costBox" min="0.01" step="0.01"${attr(row.costBox)} placeholder="0.00" aria-label="Cost per box">`);
    costFields += field('Cost/pc', `<input type="number" name="costPc" min="0.01" step="0.01"${attr(row.costPc)} placeholder="0.00" aria-label="Cost per piece">`);
  } else if (isCrate) {
    const ppt = Number(row.ppt) || 0;
    const costPcVal = ppt && row.cost !== '' ? fmt2(Number(row.cost) / ppt) : '';
    costFields += field('Cost/pc', `<input type="number" name="cost_pc" class="auto-field" readonly tabindex="-1"${costPcVal ? ` value="${ev(costPcVal)}"` : ''} placeholder="—" aria-label="Cost per piece (auto)">`);
  }

  const unitLabel = isBag ? bagBaseUnit(row) : 'pc';
  let sellFields = field(`Sell/${unitLabel}`, `<input type="number" name="sell" min="0.01" step="0.01"${attr(row.sell)} placeholder="0.00" aria-label="${isBag ? `Sell/${unitLabel}` : 'Sell/pc'}">`);
  if (isCarton) {
    sellFields += field('Sell/ctn', `<input type="number" name="sellC" min="0.01" step="0.01"${attr(row.sellC)} placeholder="0.00" aria-label="Sell price per carton">`);
  } else if (isDozen) {
    sellFields += field('Sell/dozen', `<input type="number" name="sellC" min="0.01" step="0.01"${attr(row.sellC)} placeholder="0.00" aria-label="Sell price per dozen">`);
  } else if (isBag) {
    sellFields += field('Sell/bag', `<input type="number" name="sellB" min="0.01" step="0.01"${attr(row.sellB)} placeholder="0.00" aria-label="Sell price per bag">`);
  } else if (isCartonBox) {
    sellFields += field('Sell/box', `<input type="number" name="sellBox" min="0.01" step="0.01"${attr(row.sellBox)} placeholder="0.00" aria-label="Sell price per box">`);
    sellFields += field('Sell/ctn', `<input type="number" name="sellC" min="0.01" step="0.01"${attr(row.sellC)} placeholder="0.00" aria-label="Sell price per carton">`);
  } else if (isCrate) {
    sellFields += field('Sell/tray', `<input type="number" name="sellTray" min="0.01" step="0.01"${attr(row.sellTray)} placeholder="0.00" aria-label="Sell price per tray">`);
  }

  return `<tr data-row-id="${ev(row.id)}" data-type="${ev(row.type)}">
    <td colspan="1" class="row-card-cell"><div class="row-card">
      <div class="row-card-head">
        <div class="col-name"><label class="row-card-field"><small class="cell-hint">Product name</small><input type="text" name="name" placeholder="Product name" autocomplete="off"${attr(row.name)}></label></div>
        <label class="col-type row-card-field"><small class="cell-hint">Type</small><select name="type" aria-label="Type">${typeOpts}</select></label>
        <div class="col-profit">${profitHtml(row)}</div>
        <div class="col-remove"><button type="button" class="btn-row-remove" tabindex="-1" aria-label="Remove row">×</button></div>
      </div>
      <div class="row-match-banner" role="status"></div>
      <div class="row-summary" aria-label="Collapsed row summary"></div>
      <div class="row-card-blocks">
        <section class="row-card-block"><h3>Received</h3><div class="row-card-fields">${receivedFields}</div></section>
        <section class="row-card-block"><h3>Cost</h3><div class="row-card-fields">${costFields}</div></section>
        <section class="row-card-block"><h3>Sell</h3><div class="row-card-fields">${sellFields}</div></section>
      </div>
    </div></td>
  </tr>`;
}

// ── Page ──────────────────────────────────────────────────────────────────────
export async function renderStockIn() {
  if (_activeCleanup) { _activeCleanup(); _activeCleanup = null; }

  const app = document.getElementById('app');
  app.innerHTML = '<p>Loading…</p>';

  const [{ data: suppliers, error: suppliersError }, existingProductsResult] = await Promise.all([
    getSuppliers(),
    getProducts(),
  ]);
  let existingProducts = existingProductsResult.data;
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

  const _norm = {
    name: (s) => (s ?? '').trim().replace(/\s+/g, ' ').toLowerCase(),
    cat:  (s) => (s ?? '').trim().toLowerCase(),
    unit: (s) => (s ?? '').trim().toLowerCase() || null,
    size: (v) => (v === '' || v == null || Number.isNaN(Number(v))) ? null : Number(v),
  };

  function findExisting(row) {
    const rowName = _norm.name(row.name);
    const rowCat  = _norm.cat(row.type);
    if (!rowName || !existingProducts) return null;
    if (row.type !== 'bag' && row.size_value !== '' && row.size_value != null && Number.isNaN(Number(row.size_value))) return null;
    const rowSize = row.type === 'bag' ? null : _norm.size(row.size_value);
    const rowUnit = _norm.unit(row.type === 'bag' ? bagBaseUnit(row) : row.size_unit);
    return existingProducts.find((p) =>
      _norm.name(p.name) === rowName &&
      _norm.cat(p.category) === rowCat &&
      _norm.size(p.size_value) === rowSize &&
      _norm.unit(p.size_unit) === rowUnit
    ) ?? null;
  }

  // Looser match: name + category only (catches same product before size is filled in)
  function findSimilar(row) {
    const rowName = _norm.name(row.name);
    const rowCat  = _norm.cat(row.type);
    if (!rowName || !existingProducts) return [];
    return existingProducts.filter((p) =>
      _norm.name(p.name) === rowName &&
      _norm.cat(p.category) === rowCat
    );
  }

  function updateExistingNotice(row) {
    const tr = tbody.querySelector(`tr[data-row-id="${row.id}"]`);
    if (!tr) return;
    const banner = tr.querySelector('.row-match-banner');
    if (!banner) return;

    const exact = findExisting(row);
    if (exact) {
      const stockUnit = exact.category === 'bag' ? (exact.size_unit || 'kg') : 'pcs';
      const sizeLabel = exact.size_value ? ` ${numberDisplay(exact.size_value)}${exact.size_unit || ''}` : '';
      banner.className = 'row-match-banner row-match-exact';
      banner.innerHTML = `<span class="match-icon">✓</span><span><strong>${escapeHtml(exact.name)}${escapeHtml(sizeLabel)}</strong> is already in stock — <strong>${numberDisplay(exact.stock_qty)} ${stockUnit}</strong> on hand. Qty will be added and prices updated.</span>`;
      return;
    }

    const similar = findSimilar(row);
    if (similar.length > 0) {
      const m = similar[0];
      const sizeLabel = m.size_value ? `${numberDisplay(m.size_value)}${m.size_unit || ''}` : '';
      const stockUnit = m.category === 'bag' ? (m.size_unit || 'kg') : 'pcs';
      banner.className = 'row-match-banner row-match-fuzzy';
      banner.innerHTML = `<span class="match-icon">~</span><span>Similar product exists: <strong>${escapeHtml(m.name)}${sizeLabel ? ` (${escapeHtml(sizeLabel)})` : ''}</strong> · ${numberDisplay(m.stock_qty)} ${stockUnit} in stock. Fill in the size to confirm a match.</span>`;
      return;
    }

    banner.className = 'row-match-banner';
    banner.innerHTML = '';
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
      if (row.type === 'carton' || row.type === 'dozen') {
        const ppc = Number(row.ppc) || 0;
        const cost = Number(row.cost) || 0;
        costPcInput.value = ppc && cost ? fmt2(cost / ppc) : '';
      }
    }

    if (row.type === 'bag') {
      const costInput = tr.querySelector('[name="cost"]');
      if (costInput && document.activeElement !== costInput) costInput.value = row.cost;
      const costKgInput = tr.querySelector('[name="costKg"]');
      if (costKgInput && document.activeElement !== costKgInput) costKgInput.value = row.costKg;
      const sellInput = tr.querySelector('[name="sell"]');
      if (sellInput && document.activeElement !== sellInput) sellInput.value = row.sell;
      const sellBInput = tr.querySelector('[name="sellB"]');
      if (sellBInput && document.activeElement !== sellBInput) sellBInput.value = row.sellB;
    }

    if (row.type === 'carton_box') {
      for (const name of ['cost', 'costBox', 'costPc', 'sell', 'sellBox', 'sellC']) {
        const input = tr.querySelector(`[name="${name}"]`);
        if (input && document.activeElement !== input) input.value = row[name];
      }
    }

    if (row.type === 'crate') {
      const ppt  = Number(row.ppt) || 0;
      const cost = Number(row.cost) || 0;
      if (costPcInput) {
        costPcInput.value = ppt && cost ? fmt2(cost / ppt) : '';
      }
      for (const name of ['sell', 'sellTray']) {
        const input = tr.querySelector(`[name="${name}"]`);
        if (input && document.activeElement !== input) input.value = row[name] ?? '';
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
      const sizeKey = row.type === 'bag' ? '' : row.size_value;
      const unitKey = row.type === 'bag' ? bagBaseUnit(row) : row.size_unit;
      const key = `${row.name.trim().toLowerCase()}|${row.type}|${sizeKey ?? ''}|${unitKey}`;
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

  function collapseRow(row) {
    if (isRowEmpty(row) || validateRow(row) !== null) return;
    const tr = tbody.querySelector(`tr[data-row-id="${row.id}"]`);
    if (!tr) return;

    let typeLabel = row.type.charAt(0).toUpperCase() + row.type.slice(1);
    let receivedQty = Number(row.qty) || 0;
    let receivedUnit = 'pcs';
    if (row.type === 'carton') {
      receivedQty *= Number(row.ppc) || 0;
    } else if (row.type === 'carton_box') {
      receivedQty *= (Number(row.bpc) || 0) * (Number(row.ppb) || 0);
      typeLabel = 'Carton + boxes';
    } else if (row.type === 'bag') {
      receivedQty *= bagBase(row);
      receivedUnit = bagBaseUnit(row);
    } else if (row.type === 'dozen') {
      receivedQty *= Number(row.ppc) || 0;
      typeLabel = 'Dozen';
    } else if (row.type === 'crate') {
      receivedQty *= Number(row.ppt) || 0;
      typeLabel = 'Tray';
    }

    const summary = tr.querySelector('.row-summary');
    if (!summary) return;
    summary.innerHTML = `<span class="row-summary-name">${escapeHtml(row.name.trim())}</span><span class="row-summary-type">${escapeHtml(typeLabel)}</span><span class="row-summary-qty">${numberDisplay(receivedQty)} ${receivedUnit}</span><span class="row-summary-total">${fmtKES(lineTotal(row))}</span><span class="row-summary-profit">${profitHtml(row)}</span>`;
    tr.classList.add('row-collapsed');
  }

  function appendRow() {
    const lastRow = rows.at(-1);
    const lastRowError = validateRow(lastRow);
    if (isRowEmpty(lastRow) || lastRowError !== null) {
      const tr = tbody.querySelector(`tr[data-row-id="${lastRow.id}"]`);
      tr?.classList.add('row-error');
      tr?.classList.remove('row-collapsed');

      const requiredFields = ['name', 'qty'];
      if (lastRow.type === 'carton') requiredFields.push('ppc');
      if (lastRow.type === 'carton_box') requiredFields.push('bpc', 'ppb');
      if (lastRow.type === 'bag') requiredFields.push('bagSize');
      if (lastRow.type === 'dozen') requiredFields.push('ppc');
      if (lastRow.type === 'crate') requiredFields.push('ppt');
      requiredFields.push('cost', 'sell');
      const firstInvalid = requiredFields.find((name) => name === 'name'
        ? !lastRow.name.trim()
        : !positive(lastRow[name]));
      tr?.querySelector(`[name="${firstInvalid || 'name'}"]`)?.focus();
      showToast('Finish this product first: ' + (lastRowError || 'fill in the product'), 'error');
      return false;
    }

    const activeRow = document.activeElement?.closest?.('tr[data-row-id]');
    const activeRowId = activeRow?.dataset.rowId;
    rows.forEach((row) => {
      if (row.id !== activeRowId && !isRowEmpty(row) && validateRow(row) === null) {
        collapseRow(row);
      }
    });

    const newRow = mkRow();
    rows.push(newRow);
    const tmp = document.createElement('tbody');
    tmp.innerHTML = renderRowHtml(newRow);
    const newTr = tmp.firstElementChild;
    tbody.appendChild(newTr);
    updateFooter();
    newTr.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    return true;
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
    const previousType = row.type;
    row[e.target.name] = e.target.value;

    if (e.target.name === 'type') {
      if (row.type === 'bag') {
        row.size_unit = 'kg';
      } else if (previousType === 'bag') {
        row.size_unit = 'g';
      }
      if (row.type === 'dozen' && !row.ppc) {
        row.ppc = '12';
      }
      // Full re-render — labels and extra columns change
      replaceRowDom(row);
      updateExistingNotice(row);
      tbody.querySelector(`tr[data-row-id="${row.id}"] [name="qty"]`)?.focus();
    } else if (e.target.name === 'size_unit' && row.type === 'bag') {
      const bagSize = bagBase(row);
      row.costKg = bagSize > 0 && row.cost !== '' ? fmt2(Number(row.cost) / bagSize) : '';
      row.sellB = bagSize > 0 && row.sell !== '' ? fmt2(Number(row.sell) * bagSize) : '';
      replaceRowDom(row);
      tbody.querySelector(`tr[data-row-id="${row.id}"] [name="size_unit"]`)?.focus();
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

    // ── Bidirectional sell/pc ↔ sell/dozen (dozen) ──
    if (row.type === 'dozen') {
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
      // Recalculate sell/dozen when ppc changes (if sell/pc already filled)
      if (e.target.name === 'ppc' && ppc && row.sell) {
        const newSellC = fmt2(Number(row.sell) * ppc);
        row.sellC = newSellC;
        const sellCInput = tr.querySelector('[name="sellC"]');
        if (sellCInput) sellCInput.value = newSellC;
      }
    }

    if (row.type === 'bag') {
      const bagSize = bagBase(row);
      if (bagSize > 0) {
        if (e.target.name === 'cost') {
          row.costKg = row.cost === '' ? '' : fmt2(Number(row.cost) / bagSize);
        } else if (e.target.name === 'costKg') {
          row.cost = row.costKg === '' ? '' : fmt2(Number(row.costKg) * bagSize);
        } else if (e.target.name === 'sell') {
          row.sellB = row.sell === '' ? '' : fmt2(Number(row.sell) * bagSize);
        } else if (e.target.name === 'sellB') {
          row.sell = row.sellB === '' ? '' : fmt2(Number(row.sellB) / bagSize);
        } else if (e.target.name === 'bagSize') {
          if (row.cost !== '') row.costKg = fmt2(Number(row.cost) / bagSize);
          if (row.sell !== '') row.sellB = fmt2(Number(row.sell) * bagSize);
        }
      } else if (e.target.name === 'bagSize') {
        row.costKg = '';
        row.sellB = '';
      }
    }

    if (row.type === 'carton_box') {
      const bpc = Number(row.bpc) || 0;
      const ppb = Number(row.ppb) || 0;
      const ppc = bpc * ppb;
      const hasCost = row.cost !== '';
      const hasSell = row.sell !== '';

      if (e.target.name === 'cost') {
        row.costBox = hasCost && bpc > 0 ? fmt2(Number(row.cost) / bpc) : '';
        row.costPc = hasCost && ppc > 0 ? fmt2(Number(row.cost) / ppc) : '';
      } else if (e.target.name === 'costBox') {
        row.cost = row.costBox !== '' && bpc > 0 ? fmt2(Number(row.costBox) * bpc) : '';
        row.costPc = row.cost !== '' && ppc > 0 ? fmt2(Number(row.cost) / ppc) : '';
      } else if (e.target.name === 'costPc') {
        row.cost = row.costPc !== '' && ppc > 0 ? fmt2(Number(row.costPc) * ppc) : '';
        row.costBox = row.cost !== '' && bpc > 0 ? fmt2(Number(row.cost) / bpc) : '';
      } else if (e.target.name === 'sell') {
        row.sellBox = hasSell && ppb > 0 ? fmt2(Number(row.sell) * ppb) : '';
        row.sellC = hasSell && ppc > 0 ? fmt2(Number(row.sell) * ppc) : '';
      } else if (e.target.name === 'sellBox') {
        row.sell = row.sellBox !== '' && ppb > 0 ? fmt2(Number(row.sellBox) / ppb) : '';
        row.sellC = row.sellBox !== '' && bpc > 0 ? fmt2(Number(row.sellBox) * bpc) : '';
      } else if (e.target.name === 'sellC') {
        row.sell = row.sellC !== '' && ppc > 0 ? fmt2(Number(row.sellC) / ppc) : '';
        row.sellBox = row.sellC !== '' && bpc > 0 ? fmt2(Number(row.sellC) / bpc) : '';
      } else if (e.target.name === 'bpc' || e.target.name === 'ppb') {
        row.costBox = hasCost && bpc > 0 ? fmt2(Number(row.cost) / bpc) : '';
        row.costPc = hasCost && ppc > 0 ? fmt2(Number(row.cost) / ppc) : '';
        row.sellBox = hasSell && ppb > 0 ? fmt2(Number(row.sell) * ppb) : '';
        row.sellC = hasSell && ppc > 0 ? fmt2(Number(row.sell) * ppc) : '';
      }
    }

    // ── Bidirectional sell/pc ↔ sell/tray (crate) ──
    if (row.type === 'crate') {
      const ppt = Number(row.ppt) || 0;
      if (e.target.name === 'sell' && ppt) {
        const newSellTray = fmt2(Number(row.sell) * ppt);
        row.sellTray = newSellTray;
        const sellTrayInput = tr.querySelector('[name="sellTray"]');
        if (sellTrayInput && document.activeElement !== sellTrayInput) sellTrayInput.value = newSellTray;
      }
      if (e.target.name === 'sellTray' && ppt) {
        const newSell = fmt2(Number(row.sellTray) / ppt);
        row.sell = newSell;
        const sellInput = tr.querySelector('[name="sell"]');
        if (sellInput && document.activeElement !== sellInput) sellInput.value = newSell;
      }
      // Recalculate sell/tray when ppt changes (if sell/pc already filled)
      if (e.target.name === 'ppt' && ppt && row.sell) {
        const newSellTray = fmt2(Number(row.sell) * ppt);
        row.sellTray = newSellTray;
        const sellTrayInput = tr.querySelector('[name="sellTray"]');
        if (sellTrayInput) sellTrayInput.value = newSellTray;
      }
    }

    updateDerived(row);
    clearErrors();
    updateFooter();
    checkDuplicates();
  });

  // ── tbody: remove button ─────────────────────────────────────────────────
  tbody.addEventListener('click', (e) => {
    const collapsedRow = e.target.closest('tr.row-collapsed[data-row-id]');
    if (collapsedRow && !e.target.closest('.btn-row-remove')) {
      collapsedRow.classList.remove('row-collapsed');
      collapsedRow.querySelector('[name="name"]')?.focus();
      return;
    }

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
    const allFields = [...tbody.querySelectorAll('input:not([readonly]), select')]
      .filter((field) => field.offsetParent !== null);
    const idx = allFields.indexOf(active);
    if (idx === -1) return;
    if (idx < allFields.length - 1) {
      allFields[idx + 1].focus();
    } else {
      const activeRowId = active.closest('tr[data-row-id]')?.dataset.rowId;
      const completedRow = rows.find((row) => row.id === activeRowId);
      if (appendRow()) {
        tbody.querySelector('tr:last-child [name="name"]')?.focus();
        if (completedRow) collapseRow(completedRow);
      }
    }
  });

  // ── Add row button ───────────────────────────────────────────────────────
  document.getElementById('add-row').addEventListener('click', () => {
    if (appendRow()) tbody.querySelector('tr:last-child [name="name"]')?.focus();
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
        const tr = tbody.querySelector(`tr[data-row-id="${row.id}"]`);
        tr?.classList.remove('row-collapsed');
        tr?.classList.add('row-error');
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
    // cost_price from buildPayloadItem is always per-unit (per pc for all types, per kg for bag)
    // row.sell is also per-unit — so this comparison is always apples-to-apples
    for (const row of validRows) {
      const payload     = buildPayloadItem(row);
      const costPerUnit = payload?.cost_price ?? 0;
      const unitLabel   = row.type === 'bag' ? `/${bagBaseUnit(row)}` : '/pc';
      if (Number(row.sell) < costPerUnit) {
        if (!confirm(`"${row.name}": sell (${fmtKES(Number(row.sell))}${unitLabel}) is below cost (${fmtKES(costPerUnit)}${unitLabel}). Continue?`)) {
          tbody.querySelector(`tr[data-row-id="${row.id}"]`)?.classList.add('row-error');
          return;
        }
      }
    }

    // Duplicate SKU confirm
    const dupKeys = new Map();
    for (const row of validRows) {
      const sizeKey = row.type === 'bag' ? '' : row.size_value;
      const unitKey = row.type === 'bag' ? bagBaseUnit(row) : row.size_unit;
      const key = `${row.name.trim().toLowerCase()}|${row.type}|${sizeKey ?? ''}|${unitKey}`;
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
    try {
      const { data } = await getProducts();
      if (data) existingProducts = data;
    } catch {
      // Keep the current match list if refreshing fails.
    }
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
