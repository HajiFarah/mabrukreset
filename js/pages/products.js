import { getProducts, updateProduct, deleteProduct, deleteReceipt, saveReceipt } from '../services/products.js';
import { getSuppliers } from '../services/suppliers.js';
import { db } from '../supabase.js';
import { openModal, closeModal } from '../components/modal.js';
import { showToast } from '../components/toast.js';
import { fmtKES, today } from '../utils.js';

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[char]);
}

function parseSize(raw) {
  const match = String(raw || '').trim().match(/^(\d+(?:\.\d+)?)\s*(g|kg|ml|l|L|pcs?)$/i);
  if (!match) return { size_value: null, size_unit: null };
  let unit = match[2];
  if (unit.toLowerCase() === 'l') unit = 'L';
  if (/^pcs?$/i.test(unit)) unit = 'pcs';
  return { size_value: Number(match[1]), size_unit: unit };
}

function numberDisplay(value) {
  return Number(value || 0).toLocaleString('en-KE', { maximumFractionDigits: 3 });
}

export async function renderProducts() {
  const app = document.getElementById('app');
  app.innerHTML = '<p>Loading...</p>';

  const [productsResult, suppliersResult, receiptsResult] = await Promise.all([
    getProducts(),
    getSuppliers(),
    db.from('receipts').select('*', { count: 'exact', head: true }),
  ]);
  if (productsResult.error || suppliersResult.error) {
    app.innerHTML = '<p class="error">Failed to load products.</p>';
    return;
  }

  const products = productsResult.data ?? [];
  const supplierNames = new Map((suppliersResult.data ?? []).map((supplier) => [supplier.id, supplier.name]));

  const stockValue = products.reduce((sum, p) => sum + Number(p.cost_price || 0) * Number(p.stock_qty || 0), 0);
  const potentialProfit = products.reduce((sum, p) => sum + (Number(p.sell_price || 0) - Number(p.cost_price || 0)) * Number(p.stock_qty || 0), 0);
  const supplierCount = suppliersResult.data?.length ?? 0;
  const receiptCount = receiptsResult.count ?? 0;

  app.innerHTML = `
    <div class="products-toolbar">
      <h1>Products</h1>
      <input id="search-input" type="search" placeholder="Search products..." aria-label="Search products">
      <select id="cat-filter" aria-label="Filter by category">
        <option value="">All</option>
        <option value="pieces">pieces</option>
        <option value="carton">carton</option>
        <option value="carton_box">carton_box</option>
        <option value="packet">packet</option>
        <option value="bag">bag</option>
        <option value="crate">crate</option>
        <option value="dozen">dozen</option>
      </select>
    </div>
    <div class="products-kpis">
      <article class="card">
        <h2>Stock Value</h2>
        <p>${fmtKES(stockValue)}</p>
        <small>What you paid for current inventory</small>
      </article>
      <article class="card">
        <h2>Potential Profit</h2>
        <p class="${potentialProfit >= 0 ? 'profit-positive' : 'profit-negative'}">${fmtKES(potentialProfit)}</p>
        <small>If all stock sells at listed price</small>
      </article>
      <article class="card">
        <h2>Suppliers</h2>
        <p>${supplierCount}</p>
        <small>Active suppliers on record</small>
      </article>
      <article class="card">
        <h2>Receipts</h2>
        <p>${receiptCount}</p>
        <small>Stock-in receipts recorded</small>
      </article>
    </div>
    <div id="products-table-container"></div>`;

  const modalOverlay = document.getElementById('modal-overlay');
  if (!modalOverlay.dataset.closeButtonsBound) {
    modalOverlay.addEventListener('click', (event) => {
      if (event.target.closest('[data-modal-close]')) closeModal();
    });
    modalOverlay.dataset.closeButtonsBound = 'true';
  }

  const tableContainer = document.getElementById('products-table-container');

  function applyFilters() {
    const search = document.getElementById('search-input').value.trim().toLowerCase();
    const category = document.getElementById('cat-filter').value;
    const filteredProducts = products.filter((product) => {
      const matchesSearch = product.name.toLowerCase().includes(search);
      const matchesCategory = !category || product.category === category;
      return matchesSearch && matchesCategory;
    });

    if (!filteredProducts.length) {
      tableContainer.innerHTML = '<p>No products found.</p>';
      return;
    }

    const rows = filteredProducts.map((product) => {
      const profit = Number(product.sell_price || 0) - Number(product.cost_price || 0);
      const profitClass = profit > 0 ? 'profit-positive' : profit < 0 ? 'profit-negative' : '';
      const stockUnit = product.category === 'bag' ? 'kg' : 'pcs';
      const size = [product.size_value, product.size_unit].filter((value) => value !== null && value !== '').join(' ');
      return `<tr>
        <td>${escapeHtml(product.name)}</td>
        <td>${escapeHtml(product.category)}</td>
        <td>${escapeHtml(size || '—')}</td>
        <td>${numberDisplay(product.stock_qty)} ${stockUnit}</td>
        <td>${fmtKES(product.cost_price)}</td>
        <td>${fmtKES(product.sell_price)}</td>
        <td class="${profitClass}">${fmtKES(profit)}</td>
        <td>${escapeHtml(supplierNames.get(product.supplier_id) || '—')}</td>
        <td>${escapeHtml(product.created_at ? product.created_at.slice(0, 10) : '—')}</td>
        <td class="product-actions">
          <button class="btn btn-green" type="button" data-action="restock" data-id="${escapeHtml(product.id)}">Restock</button>
          <button class="btn btn-ghost" type="button" data-action="edit" data-id="${escapeHtml(product.id)}">Edit</button>
          <button class="btn btn-red" type="button" data-action="delete" data-id="${escapeHtml(product.id)}">Delete</button>
          <button class="btn btn-ghost" type="button" data-action="delete-receipt" data-id="${escapeHtml(product.id)}">Del Receipt</button>
        </td>
      </tr>`;
    }).join('');

    tableContainer.innerHTML = `
      <table class="data-table">
        <thead><tr><th>Product</th><th>Category</th><th>Size</th><th>Stock</th><th>Cost/unit</th><th>Sell/unit</th><th>Profit/unit</th><th>Supplier name</th><th>Date added</th><th>Actions</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
  }

  document.getElementById('search-input').addEventListener('input', applyFilters);
  document.getElementById('cat-filter').addEventListener('change', applyFilters);

  tableContainer.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-action]');
    if (!button) return;
    const product = products.find((item) => item.id === button.dataset.id);
    if (!product) return;

    if (button.dataset.action === 'restock') {
      const isCarton    = product.category === 'carton';
      const isBag       = product.category === 'bag';
      const isCartonBox = product.category === 'carton_box';
      const isCrate     = product.category === 'crate';
      const isDozen     = product.category === 'dozen';

      // ppc = total pieces per outer unit (carton/crate/dozen)
      const tpc = Number(product.packets_per_box || 0);    // trays per crate
      const ppt = Number(product.pieces_per_box  || 0);    // pieces per tray
      const ppc = isCrate ? tpc * ppt : Number(product.pieces_per_carton || 0);

      const qtyLabel  = isCarton || isCartonBox ? 'Qty (cartons)'
        : isCrate  ? 'Qty (crates)'
        : isDozen  ? 'Qty (dozens)'
        : isBag    ? 'Qty (kg)'
        : 'Qty (pieces)';
      const costLabel = isCarton || isCartonBox ? 'Cost per carton (KES)'
        : isCrate  ? 'Cost per crate (KES)'
        : isDozen  ? 'Cost per dozen (KES)'
        : isBag    ? 'Total cost for this batch (KES)'
        : 'Cost per piece (KES)';
      const sellLabel = isBag ? 'kg' : 'piece';

      const metaExtra = isCarton || isDozen ? (ppc ? ` · ${ppc} pcs/carton` : '')
        : isCartonBox ? (ppc ? ` · ${product.packets_per_box} boxes/ctn · ${product.pieces_per_box} pcs/box` : '')
        : isCrate     ? (ppc ? ` · ${tpc} trays/crate · ${ppt} pcs/tray` : '')
        : '';

      openModal(`<form id="restock-form" class="restock-form">
        <h2>Restock — ${escapeHtml(product.name)}</h2>
        <p class="restock-meta">${escapeHtml(product.category)}${metaExtra} · Current stock: <strong>${numberDisplay(product.stock_qty)} pcs</strong></p>
        <label>Supplier name *
          <input name="supplier" type="text" list="restock-supplier-list" autocomplete="off" placeholder="Who did you buy from?" required>
          <datalist id="restock-supplier-list">${(suppliersResult.data ?? []).map((s) => `<option value="${escapeHtml(s.name)}"></option>`).join('')}</datalist>
        </label>
        <label>Date<input name="date" type="date" value="${today()}" required></label>
        <label>${escapeHtml(qtyLabel)}<input name="qty" type="number" min="0.001" step="any" placeholder="0" required></label>
        <label>${escapeHtml(costLabel)}<input name="cost" type="number" min="0.01" step="0.01" placeholder="0" required></label>
        <label>Sell price per ${sellLabel} (KES)<input name="sell" type="number" min="0.01" step="0.01" value="${escapeHtml(String(product.sell_price || ''))}" required></label>
        <p id="restock-profit" class="restock-profit"></p>
        <div class="modal-actions">
          <button class="btn btn-green" type="submit">Save Restock</button>
          <button class="btn btn-ghost" type="button" data-modal-close>Cancel</button>
        </div>
      </form>`);

      const form = document.getElementById('restock-form');

      function updateRestockProfit() {
        const qty  = Number(form.elements.qty.value)  || 0;
        const cost = Number(form.elements.cost.value) || 0;
        const sell = Number(form.elements.sell.value) || 0;
        if (!qty || !cost || !sell) { form.querySelector('#restock-profit').textContent = ''; return; }
        const costPerPc = (isCarton || isCartonBox || isCrate || isDozen) && ppc
          ? cost / ppc : isBag ? cost / qty : cost;
        const profitPerUnit = sell - costPerPc;
        const el = form.querySelector('#restock-profit');
        el.textContent = `Margin: ${fmtKES(profitPerUnit)} per ${sellLabel} (${costPerPc > 0 ? (profitPerUnit / costPerPc * 100).toFixed(1) : 0}%)`;
        el.className = `restock-profit ${profitPerUnit >= 0 ? 'profit-positive' : 'profit-negative'}`;
      }

      form.addEventListener('input', updateRestockProfit);

      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const submitBtn = form.querySelector('[type="submit"]');
        const supplierName = form.elements.supplier.value.trim();
        const qty  = Number(form.elements.qty.value);
        const cost = Number(form.elements.cost.value);
        const sell = Number(form.elements.sell.value);

        if (!supplierName || !qty || !cost || !sell) {
          showToast('Fill in all fields', 'error'); return;
        }

        const base = { name: product.name, size_value: product.size_value, size_unit: product.size_unit };
        let payload;
        if (isCarton) {
          payload = { ...base, category: 'carton', pieces_per_carton: ppc,
            cost_price: cost / ppc, sell_price: sell,
            carton_sell_price: Number(product.carton_sell_price || sell * ppc),
            stock_qty: qty * ppc };
        } else if (isCartonBox) {
          payload = { ...base, category: 'carton_box',
            packets_per_box: tpc || product.packets_per_box,
            pieces_per_box: ppt || product.pieces_per_box,
            pieces_per_carton: ppc,
            cost_price: cost / ppc, sell_price: sell,
            box_sell_price: Number(product.box_sell_price || sell * (product.pieces_per_box || 0)),
            carton_sell_price: Number(product.carton_sell_price || sell * ppc),
            stock_qty: qty * ppc };
        } else if (isCrate) {
          payload = { ...base, category: 'crate',
            packets_per_box: tpc, pieces_per_box: ppt, pieces_per_carton: ppc,
            cost_price: cost / ppc, sell_price: sell,
            box_sell_price: Number(product.box_sell_price || sell * ppt),
            carton_sell_price: Number(product.carton_sell_price || sell * ppc),
            stock_qty: qty * ppc };
        } else if (isDozen) {
          payload = { ...base, category: 'dozen', pieces_per_carton: ppc,
            cost_price: cost / ppc, sell_price: sell,
            carton_sell_price: Number(product.carton_sell_price || sell * ppc),
            stock_qty: qty * ppc };
        } else if (isBag) {
          payload = { ...base, category: 'bag',
            cost_price: cost / qty, sell_price: sell, stock_qty: qty };
        } else {
          payload = { ...base, category: product.category,
            cost_price: cost, sell_price: sell, stock_qty: qty };
        }

        submitBtn.disabled = true; submitBtn.textContent = 'Saving…';
        const { error } = await saveReceipt(supplierName, '', form.elements.date.value, '', [payload]);
        if (error) {
          showToast(error.message || 'Failed to save restock', 'error');
          submitBtn.disabled = false; submitBtn.textContent = 'Save Restock';
          return;
        }

        const addedPcs = isBag ? qty : (isCarton || isCartonBox || isCrate || isDozen) ? qty * ppc : qty;
        product.stock_qty = Number(product.stock_qty || 0) + addedPcs;
        product.cost_price = payload.cost_price;
        product.sell_price = sell;
        showToast(`Restocked ${escapeHtml(product.name)} — new stock: ${numberDisplay(product.stock_qty)} pcs`);
        closeModal();
        applyFilters();
      });
      return;
    }

    if (button.dataset.action === 'edit') {
      const currentSize = [product.size_value, product.size_unit].filter((v) => v !== null && v !== '').join('');
      openModal(`
        <form id="edit-product-form" data-id="${escapeHtml(product.id)}">
          <h2>Edit Product</h2>
          <div class="form-row">
            <label>Name<input name="name" type="text" value="${escapeHtml(product.name)}" required></label>
            <label>Size <small style="font-weight:400;color:var(--mute)">(e.g. 500g, 2L)</small><input name="size" type="text" value="${escapeHtml(currentSize)}" placeholder="e.g. 500g"></label>
          </div>
          <div class="form-row">
            <label>Cost price (KES)<input name="cost_price" type="number" step="0.01" value="${escapeHtml(product.cost_price ?? '')}" required></label>
            <label>Sell price (KES)<input name="sell_price" type="number" step="0.01" value="${escapeHtml(product.sell_price ?? '')}" required></label>
          </div>
          <label>Stock quantity<input name="stock_qty" type="number" step="0.001" value="${escapeHtml(product.stock_qty ?? '')}" required></label>
          <div class="modal-actions"><button class="btn btn-green" type="submit">Save</button><button class="btn btn-ghost" type="button" data-modal-close>Cancel</button></div>
        </form>`);

      document.getElementById('edit-product-form').addEventListener('submit', async (submitEvent) => {
        submitEvent.preventDefault();
        const form = submitEvent.currentTarget;
        const parsedSize = parseSize(form.elements.size.value);
        const fields = {
          name: form.elements.name.value.trim(),
          size_value: parsedSize.size_value,
          size_unit: parsedSize.size_unit,
          cost_price: Number(form.elements.cost_price.value),
          sell_price: Number(form.elements.sell_price.value),
          stock_qty: Number(form.elements.stock_qty.value),
        };
        const { error } = await updateProduct(product.id, fields);
        if (error) {
          showToast(error.message || 'Failed to update product', 'error');
          return;
        }

        Object.assign(product, fields);
        showToast('Product updated');
        closeModal();
        applyFilters();
      });
      return;
    }

    if (button.dataset.action === 'delete') {
      openModal(`<div class="confirm-dialog">
        <p>Delete ${escapeHtml(product.name)}? Supplier receipts stay as history. This cannot be undone.</p>
        <div class="modal-actions"><button class="btn btn-red" type="button" data-confirm-delete>Delete</button><button class="btn btn-ghost" type="button" data-modal-close>Cancel</button></div>
      </div>`);
      document.querySelector('[data-confirm-delete]').addEventListener('click', async () => {
        const { error } = await deleteProduct(product.id);
        if (error) {
          if (error.message?.toLowerCase().includes('sales history')) {
            showToast('Cannot delete — product has sales history', 'error');
          } else {
            showToast(error.message || 'Failed to delete product', 'error');
          }
          closeModal();
          return;
        }
        const index = products.findIndex((item) => item.id === product.id);
        if (index !== -1) products.splice(index, 1);
        showToast('Product deleted');
        closeModal();
        applyFilters();
      });
      return;
    }

    if (button.dataset.action === 'delete-receipt') {
      if (!product.receipt_id) {
        showToast('No receipt is linked to this product', 'error');
        return;
      }
      openModal(`<div class="confirm-dialog">
        <p>Delete this receipt? The stock it added will be subtracted. Products that also have stock from other suppliers will stay.</p>
        <div class="modal-actions"><button class="btn btn-red" type="button" data-confirm-delete-receipt>Delete Receipt</button><button class="btn btn-ghost" type="button" data-modal-close>Cancel</button></div>
      </div>`);
      document.querySelector('[data-confirm-delete-receipt]').addEventListener('click', async (event) => {
        event.currentTarget.disabled = true;
        const { data, error } = await deleteReceipt(product.receipt_id);
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
        try {
          const [productsReload, suppliersReload] = await Promise.all([getProducts(), getSuppliers()]);
          if (productsReload.error) throw productsReload.error;
          products.splice(0, products.length, ...(productsReload.data ?? []));
          if (!suppliersReload.error) {
            supplierNames.clear();
            (suppliersReload.data ?? []).forEach((supplier) => supplierNames.set(supplier.id, supplier.name));
          }
        } catch {
          // Keep the successful deletion toast visible if the reload fails.
        }
        applyFilters();
      });
    }
  });

  applyFilters();
}
