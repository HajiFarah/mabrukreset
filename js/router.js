import { renderSell } from './pages/sell.js';
import { renderStockIn } from './pages/stockIn.js';
import { renderProducts } from './pages/products.js';
import { renderSuppliers } from './pages/suppliers.js';
import { renderSupplierDetail } from './pages/supplierDetail.js';
import { renderCredits } from './pages/credits.js';
import { renderHistory } from './pages/salesHistory.js';
import { renderFinancial } from './pages/financial.js';

const routes = {
  '#/sell': renderSell,
  '#/stock-in': renderStockIn,
  '#/products': renderProducts,
  '#/suppliers': renderSuppliers,
  '#/credits': renderCredits,
  '#/history': renderHistory,
  '#/financial': renderFinancial,
};

function renderRoute() {
  const hash = window.location.hash;
  const detailMatch = hash.match(/^#\/suppliers\/(.+)$/);

  if (detailMatch) {
    document.querySelectorAll('#sidebar [data-route]').forEach((link) => {
      link.classList.toggle('active', link.dataset.route === '#/suppliers');
    });
    renderSupplierDetail(decodeURIComponent(detailMatch[1]));
    return;
  }

  if (!hash) {
    window.location.hash = '#/sell';
    return;
  }

  const render = routes[hash];
  if (render) {
    document.querySelectorAll('#sidebar [data-route]').forEach((link) => {
      link.classList.toggle('active', link.dataset.route === hash);
    });
    render();
  } else {
    window.location.hash = '#/sell';
  }
}

export function initRouter() {
  window.addEventListener('hashchange', renderRoute);
  renderRoute();
}
