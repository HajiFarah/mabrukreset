const fs = require('fs');
const path = require('path');
const { marked } = require('marked');

const md = fs.readFileSync(path.join(__dirname, 'MABRUK_PRODUCT_CATALOG.md'), 'utf8');
const body = marked(md);

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Mabruk Shop — Master Product Catalog</title>
<style>
  /* ── Reset ────────────────────────────────────────── */
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  /* ── Page shell ───────────────────────────────────── */
  body {
    font-family: 'Segoe UI', system-ui, Arial, sans-serif;
    font-size: 15px;
    line-height: 1.7;
    color: #1c1c1c;
    background: #e8e4dd;
  }

  .layout {
    display: flex;
    min-height: 100vh;
  }

  /* ── Sidebar ──────────────────────────────────────── */
  .sidebar {
    width: 260px;
    flex-shrink: 0;
    background: #1a1a1a;
    color: #ccc;
    padding: 28px 0;
    position: sticky;
    top: 0;
    height: 100vh;
    overflow-y: auto;
  }

  .sidebar-title {
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: #c9912b;
    padding: 0 22px 14px;
    border-bottom: 1px solid #333;
    margin-bottom: 10px;
  }

  .sidebar a {
    display: block;
    padding: 6px 22px;
    font-size: 13px;
    color: #b0b0b0;
    text-decoration: none;
    border-left: 3px solid transparent;
    line-height: 1.4;
    transition: all 0.12s;
  }

  .sidebar a:hover {
    color: #fff;
    border-left-color: #c9912b;
    background: rgba(201,145,43,0.1);
  }

  .sidebar a.flag-link { color: #d98080; }
  .sidebar a.flag-link:hover {
    color: #ffaaaa;
    border-left-color: #c0392b;
    background: rgba(192,57,43,0.1);
  }

  .sidebar-divider {
    border: none;
    border-top: 1px solid #2d2d2d;
    margin: 8px 22px;
  }

  .sidebar::-webkit-scrollbar { width: 4px; }
  .sidebar::-webkit-scrollbar-track { background: #111; }
  .sidebar::-webkit-scrollbar-thumb { background: #444; border-radius: 2px; }

  /* ── Main content ─────────────────────────────────── */
  .main {
    flex: 1;
    min-width: 0;
    background: #fff;
    /* Constrain content width so it doesn't stretch edge-to-edge */
    padding: 56px 72px;
  }

  /* Inner content max-width for comfortable reading */
  .main > * {
    max-width: 860px;
  }

  /* Tables get a bit more room */
  .main > table,
  .main > blockquote {
    max-width: 100%;
  }

  /* ── Typography ───────────────────────────────────── */
  h1 {
    font-size: 30px;
    font-weight: 800;
    color: #1a1a1a;
    letter-spacing: -0.02em;
    border-bottom: 4px solid #c9912b;
    padding-bottom: 16px;
    margin-bottom: 8px;
    max-width: 100%;
  }

  /* Meta info lines after h1 */
  h1 ~ p:not(h2 ~ p):not(h3 ~ p) {
    font-size: 13.5px;
    color: #666;
    margin-bottom: 4px;
    line-height: 1.5;
  }

  h2 {
    font-size: 18px;
    font-weight: 700;
    color: #8a6010;
    margin-top: 52px;
    margin-bottom: 16px;
    padding: 12px 18px;
    background: #fdf8ee;
    border-left: 5px solid #c9912b;
    border-radius: 0 5px 5px 0;
    max-width: 100%;
  }

  h3 {
    font-size: 14px;
    font-weight: 700;
    color: #555;
    margin-top: 28px;
    margin-bottom: 12px;
    padding-bottom: 5px;
    border-bottom: 1px dashed #d8d3c8;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    max-width: 100%;
  }

  h3[id*="flag"] {
    color: #a93226;
    border-bottom-color: #f1b0a8;
  }

  h2#flags--issues-to-resolve-before-seeding {
    color: #922b21;
    background: #fdf0ef;
    border-left-color: #c0392b;
  }

  p {
    font-size: 15px;
    margin-bottom: 12px;
    color: #333;
  }

  strong { color: #111; }
  a { color: #c9912b; }

  /* ── Tables ───────────────────────────────────────── */
  table {
    width: 100%;
    max-width: 100%;
    border-collapse: collapse;
    margin: 6px 0 28px;
    font-size: 13.5px;
    border: 1px solid #dedad1;
    border-radius: 6px;
    overflow: hidden;
  }

  thead tr {
    background: #252525;
    color: #f0f0f0;
  }

  thead th {
    padding: 10px 14px;
    text-align: left;
    font-size: 11.5px;
    font-weight: 700;
    letter-spacing: 0.07em;
    text-transform: uppercase;
    white-space: nowrap;
    border-right: 1px solid #3a3a3a;
  }

  thead th:last-child { border-right: none; }

  tbody tr:nth-child(even) { background: #faf9f5; }
  tbody tr:hover { background: #fef5e0; transition: background 0.1s; }

  tbody td {
    padding: 8px 14px;
    border-bottom: 1px solid #ecea e2;
    border-right: 1px solid #f0ede5;
    vertical-align: top;
    color: #2a2a2a;
    font-size: 13.5px;
    line-height: 1.55;
  }

  tbody td:last-child {
    border-right: none;
    color: #666;
    font-size: 13px;
  }

  /* Cost/price column (4th col) */
  tbody td:nth-child(4) {
    font-variant-numeric: tabular-nums;
    font-weight: 600;
    color: #1a5c1a;
    white-space: nowrap;
  }

  /* ── Blockquotes ──────────────────────────────────── */
  blockquote {
    border-left: 5px solid #c9912b;
    margin: 16px 0;
    padding: 12px 18px;
    background: #fffaf2;
    border-radius: 0 5px 5px 0;
    max-width: 100%;
  }

  blockquote p {
    margin: 0;
    font-size: 14px;
    color: #7a4d00;
    line-height: 1.6;
  }

  /* Warning blockquotes */
  blockquote:has(p) {
    border-left-color: #c0392b;
    background: #fdf3f2;
  }

  blockquote p { color: #922b21; font-weight: 500; }

  /* ── Lists ────────────────────────────────────────── */
  ul, ol {
    margin: 10px 0 16px 26px;
  }

  li {
    margin-bottom: 6px;
    color: #333;
    font-size: 14px;
    line-height: 1.6;
  }

  /* ── Code ─────────────────────────────────────────── */
  code {
    background: #f0ede5;
    padding: 2px 7px;
    border-radius: 4px;
    font-family: 'Consolas', 'Cascadia Code', monospace;
    font-size: 13px;
    color: #5a3e00;
  }

  /* ── Dividers ─────────────────────────────────────── */
  hr {
    border: none;
    border-top: 1px solid #e5e1d8;
    margin: 40px 0;
    max-width: 100%;
  }

  /* ── Print ────────────────────────────────────────── */
  @media print {
    .sidebar { display: none; }
    .main { padding: 24px 36px; }
    .main > * { max-width: 100%; }
    body { background: #fff; font-size: 12px; }
    h1 { font-size: 22px; }
    h2 { font-size: 15px; margin-top: 20px; padding: 8px 12px; page-break-after: avoid; }
    h3 { font-size: 12px; page-break-after: avoid; }
    table { font-size: 11px; page-break-inside: auto; }
    thead { display: table-header-group; }
    tr { page-break-inside: avoid; }
    .layout { display: block; }
  }
</style>
</head>
<body>

<div class="layout">

  <nav class="sidebar">
    <div class="sidebar-title">Mabruk Catalog</div>
    <a href="#mabruk-shop--master-product-catalog">Overview</a>
    <a href="#summary">Summary</a>
    <a href="#supplier-directory">Suppliers</a>
    <hr class="sidebar-divider">
    <a href="#section-1-spices--seasonings">1. Spices</a>
    <a href="#section-2-flours-grains--pasta">2. Flours &amp; Pasta</a>
    <a href="#section-3-rice">3. Rice</a>
    <a href="#section-4-sugar--baking">4. Sugar &amp; Baking</a>
    <a href="#section-5-cooking-oils--fats">5. Oils &amp; Fats</a>
    <a href="#section-6-dairy--milk">6. Dairy &amp; Milk</a>
    <a href="#section-7-beverages--juices">7. Juices</a>
    <a href="#section-8-beverages--sodas">8. Sodas</a>
    <a href="#section-9-water">9. Water</a>
    <a href="#section-10-tea--coffee">10. Tea &amp; Coffee</a>
    <a href="#section-11-breakfast-cereals">11. Cereals</a>
    <a href="#section-12-condiments--sauces">12. Condiments</a>
    <a href="#section-13-canned--preserved-foods">13. Canned Foods</a>
    <a href="#section-14-snacks-biscuits--confectionery">14. Snacks</a>
    <a href="#section-15-pulses--legumes">15. Pulses</a>
    <a href="#section-16-salt">16. Salt</a>
    <a href="#section-17-personal-care--soaps">17. Soaps</a>
    <a href="#section-18-personal-care--shampoos-hair--body">18. Shampoos &amp; Hair</a>
    <a href="#section-19-oral-care">19. Oral Care</a>
    <a href="#section-20-cleaning-products">20. Cleaning</a>
    <a href="#section-21-sanitary--paper-products">21. Sanitary &amp; Paper</a>
    <a href="#section-22-air-fresheners--household">22. Air Fresheners</a>
    <a href="#section-23-batteries">23. Batteries</a>
    <a href="#section-24-personal-grooming">24. Grooming</a>
    <a href="#section-25-electronics-non-grocery">25. Electronics</a>
    <a href="#section-26-miscellaneous--needs-verification">26. Misc / Verify</a>
    <hr class="sidebar-divider">
    <a href="#flags--issues-to-resolve-before-seeding" class="flag-link">⚠ All Flags</a>
    <a href="#flag-1-voided-items--do-not-seed-as-stock-received" class="flag-link">Flag 1: Voided</a>
    <a href="#flag-2-unpaid-invoice--supersanta-hub-supply" class="flag-link">Flag 2: Unpaid</a>
    <a href="#flag-3-duplicate-receipt-images--count-only-once-per-event" class="flag-link">Flag 3: Duplicates</a>
    <a href="#flag-4-price-discrepancies--verify-against-paper-originals" class="flag-link">Flag 4: Prices</a>
    <a href="#flag-5-customer-name-discrepancies-on-receipts" class="flag-link">Flag 5: Names</a>
    <a href="#flag-6-blurry--unreadable-items" class="flag-link">Flag 6: Blurry</a>
    <a href="#flag-7-items-requiring-product-category-confirmation" class="flag-link">Flag 7: Categories</a>
  </nav>

  <main class="main">
    ${body}
  </main>

</div>

</body>
</html>`;

const outPath = path.join(__dirname, 'MABRUK_PRODUCT_CATALOG.html');
fs.writeFileSync(outPath, html, 'utf8');
console.log('Written: ' + outPath);
console.log('Size: ' + (html.length / 1024).toFixed(1) + ' KB');
