const fs   = require('fs');
const path = require('path');
const { marked, Renderer } = require('marked');

// ── Slug helper (mirrors GitHub's heading ID format) ──────────────────────────
function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')   // strip punctuation except hyphens
    .trim()
    .replace(/[\s_]+/g, '-')    // spaces/underscores → hyphens
    .replace(/-+/g, '-');       // collapse multiple hyphens
}

// ── Custom renderer that stamps id="" on every heading ────────────────────────
const headings = [];   // collected to build the sidebar

const renderer = new Renderer();
renderer.heading = function({ text, depth }) {
  const raw  = text.replace(/<[^>]+>/g, '');   // strip any inline HTML
  const slug = slugify(raw);
  headings.push({ depth, text: raw, slug });
  return `<h${depth} id="${slug}">${text}</h${depth}>\n`;
};

marked.use({ renderer });

// ── Read & convert markdown ────────────────────────────────────────────────────
const mdPath = path.join(__dirname, 'MABRUK_PRODUCT_CATALOG.md');
const md     = fs.readFileSync(mdPath, 'utf8');
const body   = marked(md);

// ── Build sidebar from collected headings ─────────────────────────────────────
function buildSidebar(headings) {
  const lines = [];
  for (const h of headings) {
    if (h.depth === 1) continue;   // skip the doc title

    const isFlag = /flag/i.test(h.text);
    const isSub  = h.depth >= 3;
    const cls    = isFlag ? ' class="flag-link"' : (isSub ? ' class="sub-link"' : '');
    const indent = isSub ? ' style="padding-left:32px;font-size:12px;"' : '';
    const label  = isFlag ? `&#9888; ${h.text}` : h.text;

    // Divider before Flags section
    if (/^flags/i.test(h.text) && h.depth === 2) {
      lines.push('<hr class="sidebar-divider">');
    }

    lines.push(`<a href="#${h.slug}"${cls}${indent}>${label}</a>`);
  }
  return lines.join('\n');
}

const sidebarLinks = buildSidebar(headings);

// ── Full HTML ──────────────────────────────────────────────────────────────────
const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Mabruk Shop — Master Product Catalog</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  body {
    font-family: 'Segoe UI', system-ui, Arial, sans-serif;
    font-size: 15px;
    line-height: 1.7;
    color: #1c1c1c;
    background: #e8e4dd;
  }

  .layout { display: flex; min-height: 100vh; }

  /* ── Sidebar ── */
  .sidebar {
    width: 256px;
    flex-shrink: 0;
    background: #1a1a1a;
    position: sticky;
    top: 0;
    height: 100vh;
    overflow-y: auto;
    padding: 24px 0;
  }

  .sidebar-title {
    font-size: 10.5px;
    font-weight: 700;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: #c9912b;
    padding: 0 20px 14px;
    border-bottom: 1px solid #2e2e2e;
    margin-bottom: 8px;
  }

  .sidebar a {
    display: block;
    padding: 5px 20px;
    font-size: 13px;
    color: #aaa;
    text-decoration: none;
    border-left: 3px solid transparent;
    line-height: 1.4;
    transition: color 0.12s, background 0.12s, border-color 0.12s;
  }

  .sidebar a:hover, .sidebar a.active {
    color: #fff;
    border-left-color: #c9912b;
    background: rgba(201,145,43,0.1);
  }

  .sidebar a.flag-link { color: #d08080; }
  .sidebar a.flag-link:hover, .sidebar a.flag-link.active {
    color: #ffaaaa;
    border-left-color: #c0392b;
    background: rgba(192,57,43,0.1);
  }

  .sidebar a.sub-link { color: #888; }

  .sidebar-divider { border: none; border-top: 1px solid #2e2e2e; margin: 8px 20px; }

  .sidebar::-webkit-scrollbar { width: 4px; }
  .sidebar::-webkit-scrollbar-track { background: #111; }
  .sidebar::-webkit-scrollbar-thumb { background: #444; border-radius: 2px; }

  /* ── Main ── */
  .main {
    flex: 1;
    min-width: 0;
    background: #fff;
    padding: 56px 80px;
  }

  /* Constrain readable line length */
  .main > h1, .main > h2, .main > h3,
  .main > p, .main > ul, .main > ol,
  .main > blockquote, .main > hr {
    max-width: 820px;
  }

  .main > table { max-width: 960px; }

  /* ── Headings ── */
  h1 {
    font-size: 30px;
    font-weight: 800;
    letter-spacing: -0.02em;
    border-bottom: 4px solid #c9912b;
    padding-bottom: 16px;
    margin-bottom: 6px;
    scroll-margin-top: 24px;
  }

  h2 {
    font-size: 18px;
    font-weight: 700;
    color: #7a5510;
    margin-top: 52px;
    margin-bottom: 16px;
    padding: 11px 18px;
    background: #fdf8ee;
    border-left: 5px solid #c9912b;
    border-radius: 0 5px 5px 0;
    scroll-margin-top: 24px;
  }

  h2[id*="flag"] {
    color: #922b21;
    background: #fdf0ef;
    border-left-color: #c0392b;
  }

  h3 {
    font-size: 13.5px;
    font-weight: 700;
    color: #555;
    margin-top: 28px;
    margin-bottom: 12px;
    padding-bottom: 5px;
    border-bottom: 1px dashed #d5d0c8;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    scroll-margin-top: 24px;
  }

  h3[id*="flag"] { color: #a93226; border-bottom-color: #f0b0a8; }

  p { font-size: 15px; margin-bottom: 12px; color: #333; }
  strong { color: #111; }
  a { color: #c9912b; }

  /* ── Tables ── */
  table {
    width: 100%;
    border-collapse: collapse;
    margin: 6px 0 28px;
    font-size: 13.5px;
    border: 1px solid #dedad1;
    border-radius: 6px;
    overflow: hidden;
  }

  thead tr { background: #252525; color: #f0f0f0; }

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
  tbody tr:hover { background: #fef5e0; }

  tbody td {
    padding: 8px 14px;
    border-bottom: 1px solid #eceae2;
    border-right: 1px solid #f0ede5;
    vertical-align: top;
    font-size: 13.5px;
    line-height: 1.55;
    color: #2a2a2a;
  }

  tbody td:last-child { border-right: none; color: #666; font-size: 13px; }

  tbody td:nth-child(4) {
    font-variant-numeric: tabular-nums;
    font-weight: 600;
    color: #1a5c1a;
    white-space: nowrap;
  }

  /* ── Blockquotes ── */
  blockquote {
    border-left: 5px solid #c0392b;
    margin: 14px 0;
    padding: 11px 18px;
    background: #fdf3f2;
    border-radius: 0 5px 5px 0;
  }

  blockquote p { margin: 0; font-size: 14px; color: #922b21; font-weight: 500; line-height: 1.6; }

  /* ── Lists ── */
  ul, ol { margin: 10px 0 16px 26px; }
  li { margin-bottom: 6px; color: #333; font-size: 14px; line-height: 1.6; }

  /* ── Code ── */
  code {
    background: #f0ede5;
    padding: 2px 7px;
    border-radius: 4px;
    font-family: 'Consolas', monospace;
    font-size: 13px;
    color: #5a3e00;
  }

  hr { border: none; border-top: 1px solid #e5e1d8; margin: 40px 0; }

  /* ── Print ── */
  @media print {
    .sidebar { display: none; }
    .main { padding: 24px 36px; }
    .main > * { max-width: 100% !important; }
    body { background: #fff; font-size: 12px; }
    h2 { font-size: 14px; margin-top: 20px; padding: 7px 12px; page-break-after: avoid; }
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
    ${sidebarLinks}
  </nav>

  <main class="main">
    ${body}
  </main>

</div>

<script>
  // Highlight active sidebar link as you scroll
  const links      = Array.from(document.querySelectorAll('.sidebar a[href^="#"]'));
  const headingEls = Array.from(document.querySelectorAll('h1[id],h2[id],h3[id]'));

  function getActive() {
    const scrollY = window.scrollY + 90;
    let current = headingEls[0];
    for (const el of headingEls) {
      if (el.getBoundingClientRect().top + window.scrollY <= scrollY) current = el;
    }
    return current;
  }

  function onScroll() {
    const active = getActive();
    if (!active) return;
    links.forEach(a => a.classList.remove('active'));
    const match = links.find(a => a.getAttribute('href') === '#' + active.id);
    if (match) {
      match.classList.add('active');
      // Scroll sidebar to keep active link visible
      const sidebar = document.querySelector('.sidebar');
      const linkTop = match.offsetTop;
      const sidebarH = sidebar.clientHeight;
      if (linkTop < sidebar.scrollTop || linkTop > sidebar.scrollTop + sidebarH - 60) {
        sidebar.scrollTop = linkTop - sidebarH / 2;
      }
    }
  }

  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
</script>

</body>
</html>`;

const outPath = path.join(__dirname, 'MABRUK_PRODUCT_CATALOG.html');
fs.writeFileSync(outPath, html, 'utf8');
console.log('Written: ' + outPath);
console.log('Headings indexed: ' + headings.length);
console.log('Sidebar links: ' + (sidebarLinks.match(/<a /g) || []).length);
console.log('Size: ' + (html.length / 1024).toFixed(1) + ' KB');
