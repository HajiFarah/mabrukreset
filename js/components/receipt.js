// Thermal receipt — ported from mabruk-store receipt page
// Supports 58mm and 80mm paper, print popup, WhatsApp share

const STORE_NAME     = 'MABRUUK GENERAL SHOP';
const STORE_ADDRESS  = '11th Street, Hajiyusuf Avenue';
const STORE_CITY     = 'Eastleigh, Nairobi';
const STORE_PHONE    = '0729 298 175';
const STORE_AGENT    = 'Agent: 2914430 / Store: 2916186';
const STORE_BUYGOODS = 'Buy Goods: 1587693';

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function money(n) {
  return Number(n || 0).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function refNo(id) {
  if (!id) return '';
  return id.replace(/-/g, '').slice(-8).toUpperCase();
}

function fmtDate(raw) {
  if (!raw) return '';
  const d = new Date(raw);
  if (isNaN(d.getTime())) return raw;
  const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${String(d.getDate()).padStart(2,'0')}-${M[d.getMonth()]}-${d.getFullYear()}`;
}

function fmtTime(raw) {
  if (!raw) return '';
  const d = new Date(raw);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit', hour12: true });
}

function txLabel(sale) {
  const cash  = Number(sale.paid_cash  || 0);
  const mpesa = Number(sale.paid_mpesa || 0);
  if (cash > 0 && mpesa > 0) return 'Cash + M-Pesa';
  if (mpesa > 0) return 'M-Pesa Sale';
  return 'Cash Sale';
}

function itemRows(items) {
  return items.map(it => {
    const qty   = Number(it.qty || 1);
    const price = Number(it.unit_price || 0);
    const lt    = Number(it.line_total || 0);
    const unit  = it.unit_sold === 'kg' ? 'KG' : it.unit_sold === 'carton' ? 'carton' : '';
    const qtyLabel = unit ? `${qty} ${unit}` : String(qty);
    return { name: esc(it.product_name || '---'), qtyLabel, price, lt };
  });
}

// ── WhatsApp text ────────────────────────────────────────────────────────────
export function buildWhatsAppText(sale, items) {
  const total = Number(sale.total || 0);
  const paid  = Number(sale.paid_cash || 0) + Number(sale.paid_mpesa || 0);
  const bal   = total - paid;
  const lines = [
    `*${STORE_NAME}*`,
    `Receipt #${refNo(sale.id)}`,
    `${fmtDate(sale.created_at)} ${fmtTime(sale.created_at)}`,
  ];
  if (sale.client_name) {
    lines.push(`Customer: ${sale.client_name}${sale.client_phone ? ` (${sale.client_phone})` : ''}`);
  }
  lines.push('---');
  itemRows(items).forEach(({ name, qtyLabel, price, lt }) => {
    lines.push(`${qtyLabel} x ${name} = *KES ${money(lt)}*`);
  });
  lines.push('---');
  lines.push(`*TOTAL: KES ${money(total)}*`);
  lines.push(`Paid: KES ${money(paid)} (${txLabel(sale)})`);
  if (bal > 0) lines.push(`*Balance: KES ${money(bal)}*`);
  lines.push('');
  lines.push(`*${STORE_BUYGOODS}*`);
  lines.push(`Tel: ${STORE_PHONE}`);
  lines.push(`_Thank you — ${STORE_NAME}_`);
  return lines.join('\n');
}

// ── Print HTML ───────────────────────────────────────────────────────────────
export function buildPrintHTML(sale, items, servedBy, paperSize) {
  const total  = Number(sale.total || 0);
  const paid   = Number(sale.paid_cash || 0) + Number(sale.paid_mpesa || 0);
  const bal    = total - paid;
  const is58   = paperSize === '58';
  const count  = items.length;

  const rows = itemRows(items).map(({ name, qtyLabel, price, lt }) =>
    `<div style="margin-bottom:3px"><div style="font-weight:700">${name}</div>`+
    `<div class="r" style="font-size:${is58?'8pt':'8.5pt'};color:#555">`+
    `<span>${qtyLabel} x ${money(price)}</span>`+
    `<span style="font-weight:800;color:#000">${money(lt)}</span></div></div>`
  ).join('');

  const customerLine = sale.client_name
    ? `<div>${esc(sale.client_name)}${sale.client_phone ? ` &middot; ${esc(sale.client_phone)}` : ''}</div>`
    : '';

  const payLine = (Number(sale.paid_cash||0) > 0 && Number(sale.paid_mpesa||0) > 0)
    ? `<div class="r" style="font-weight:600"><span>Cash</span><span>KES ${money(sale.paid_cash)}</span></div>`+
      `<div class="r" style="font-weight:600"><span>M-Pesa</span><span>KES ${money(sale.paid_mpesa)}</span></div>`
    : `<div class="r" style="font-weight:600"><span>Paid (${Number(sale.paid_mpesa||0)>0?'M-Pesa':'Cash'})</span><span>KES ${money(paid)}</span></div>`;

  const balLine = bal > 0
    ? `<div class="r b" style="color:#B23A3A"><span>BALANCE</span><span>KES ${money(bal)}</span></div>`
    : paid > total
    ? `<div class="r b" style="color:#2E7D5B"><span>CHANGE</span><span>KES ${money(paid-total)}</span></div>`
    : '';

  return `<!DOCTYPE html><html><head><meta charset="utf-8"/><style>
@page{size:${paperSize}mm auto;margin:0}
@media print{@page{margin:0}html,body{margin:0;padding:3mm}}
*{box-sizing:border-box;margin:0;padding:0}
html,body{margin:0;padding:3mm;height:auto}
body{font-family:'Calibri','Trebuchet MS',sans-serif;font-size:${is58?'9pt':'9.5pt'};width:${is58?'52mm':'72mm'};line-height:1.4;color:#000}
.b{font-weight:900}.c{text-align:center}
.r{display:flex;justify-content:space-between;line-height:1.5}
hr{border:none;border-top:1px dashed #aaa;margin:4px 0}
</style></head><body>
<div class="c">
  <div class="b" style="font-size:1.2em;letter-spacing:1.5px">${esc(STORE_NAME)}</div>
  <div style="font-size:0.8em;color:#555">${esc(STORE_ADDRESS)}, ${esc(STORE_CITY)}</div>
  <div style="font-size:0.95em;font-weight:700">Tel: ${esc(STORE_PHONE)}</div>
  <div style="font-size:0.72em;color:#666">${esc(STORE_AGENT)}</div>
  <div style="font-size:1.05em;font-weight:900;margin-top:2px">${esc(STORE_BUYGOODS)}</div>
</div>
<hr/>
<div class="c b" style="font-size:1.15em;letter-spacing:3px;margin:2px 0">*${refNo(sale.id)}*</div>
<div style="font-size:0.88em;color:#444">
  <div class="r"><span style="font-weight:700">${txLabel(sale)}</span><span>${fmtDate(sale.created_at)} ${fmtTime(sale.created_at)}</span></div>
  ${customerLine}
</div>
<hr/>
${rows}
<hr style="border-top:1.5px dashed #888"/>
<div class="r b" style="font-size:1.05em"><span>TOTAL</span><span>KES ${money(total)}</span></div>
${payLine}
${balLine}
<div style="font-size:0.8em;color:#666;margin-top:2px">Items: ${count}</div>
<hr/>
<div class="c" style="font-size:0.9em;margin-bottom:2px">Thank you for shopping with us!</div>
${servedBy ? `<div style="font-size:0.82em">Served by: <b>${esc(servedBy)}</b></div>` : ''}
<div style="font-size:0.72em;color:#888;margin-top:2px">Goods once sold are not returnable</div>
<div class="c" style="font-size:0.65em;color:#aaa;margin-top:4px">Powered by Riyo Technology</div>
<script>window.onload=function(){window.print();window.close()}<\/script>
</body></html>`;
}

// ── Receipt preview HTML (for in-app modal) ──────────────────────────────────
export function buildReceiptPreviewHTML(sale, items, paperSize = '80') {
  const total  = Number(sale.total || 0);
  const paid   = Number(sale.paid_cash || 0) + Number(sale.paid_mpesa || 0);
  const bal    = total - paid;
  const width  = paperSize === '58' ? '230px' : '310px';

  const rows = itemRows(items).map(({ name, qtyLabel, price, lt }) =>
    `<div style="margin-bottom:4px">
      <div style="font-weight:700;font-size:12px">${name}</div>
      <div style="display:flex;justify-content:space-between;font-size:11px;color:#555">
        <span>${qtyLabel} × ${money(price)}</span>
        <span style="font-weight:800;color:#000">${money(lt)}</span>
      </div>
    </div>`
  ).join('');

  const customerLine = sale.client_name
    ? `<div>${esc(sale.client_name)}${sale.client_phone ? ` · ${esc(sale.client_phone)}` : ''}</div>`
    : '';

  const dash = 'border:none;border-top:1px dashed #aaa;margin:5px 0';

  return `<div style="font-family:'Calibri','Trebuchet MS',sans-serif;font-size:12px;color:#000;line-height:1.4;width:${width};margin:0 auto">
    <div style="text-align:center;margin-bottom:4px">
      <div style="font-weight:900;font-size:15px;letter-spacing:1.5px">${esc(STORE_NAME)}</div>
      <div style="font-size:10px;color:#555">${esc(STORE_ADDRESS)}, ${esc(STORE_CITY)}</div>
      <div style="font-size:12px;font-weight:700">Tel: ${esc(STORE_PHONE)}</div>
      <div style="font-size:9px;color:#666">${esc(STORE_AGENT)}</div>
      <div style="font-size:13px;font-weight:900;margin-top:2px">${esc(STORE_BUYGOODS)}</div>
    </div>
    <hr style="${dash}"/>
    <div style="text-align:center;font-weight:900;font-size:14px;letter-spacing:3px;margin:3px 0">*${refNo(sale.id)}*</div>
    <div style="font-size:11px;color:#444">
      <div style="display:flex;justify-content:space-between">
        <span style="font-weight:700">${txLabel(sale)}</span>
        <span>${fmtDate(sale.created_at)} ${fmtTime(sale.created_at)}</span>
      </div>
      ${customerLine}
    </div>
    <hr style="${dash}"/>
    ${rows}
    <hr style="border:none;border-top:1.5px dashed #888;margin:5px 0"/>
    <div style="display:flex;justify-content:space-between;font-weight:900;font-size:13px">${'<span>TOTAL</span>'}<span>KES ${money(total)}</span></div>
    ${Number(sale.paid_cash||0)>0 && Number(sale.paid_mpesa||0)>0
      ? `<div style="display:flex;justify-content:space-between;font-size:12px"><span>Cash</span><span>KES ${money(sale.paid_cash)}</span></div>`+
        `<div style="display:flex;justify-content:space-between;font-size:12px"><span>M-Pesa</span><span>KES ${money(sale.paid_mpesa)}</span></div>`
      : `<div style="display:flex;justify-content:space-between;font-size:12px"><span>Paid (${Number(sale.paid_mpesa||0)>0?'M-Pesa':'Cash'})</span><span>KES ${money(paid)}</span></div>`}
    ${bal > 0 ? `<div style="display:flex;justify-content:space-between;font-weight:900;font-size:13px;color:#B23A3A"><span>BALANCE</span><span>KES ${money(bal)}</span></div>` : ''}
    <div style="font-size:10px;color:#666;margin-top:2px">Items: ${items.length}</div>
    <hr style="${dash}"/>
    <div style="text-align:center;font-size:11px">Thank you for shopping with us!</div>
    <div style="font-size:9px;color:#888;margin-top:2px">Goods once sold are not returnable</div>
    <div style="text-align:center;font-size:8px;color:#aaa;margin-top:4px">Powered by Riyo Technology</div>
  </div>`;
}

// ── Open print popup ─────────────────────────────────────────────────────────
export function openPrintWindow(sale, items, servedBy, paperSize) {
  const html = buildPrintHTML(sale, items, servedBy, paperSize);
  const win = window.open('', '_blank', 'width=440,height=720');
  if (!win) { alert('Pop-up blocked — allow pop-ups to print.'); return; }
  win.document.write(html);
  win.document.close();
}

// ── Open WhatsApp ─────────────────────────────────────────────────────────────
export function openWhatsApp(sale, items) {
  const phone = sale.client_phone
    ? sale.client_phone.replace(/\D/g, '').replace(/^0/, '254')
    : '';
  const text = encodeURIComponent(buildWhatsAppText(sale, items));
  window.open(`https://wa.me/${phone}?text=${text}`, '_blank');
}
