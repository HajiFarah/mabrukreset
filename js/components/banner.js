import { db } from '../supabase.js';
import { showToast } from './toast.js';
import { fmtKES } from '../utils.js';

export async function refreshBanner() {
  const banner = document.getElementById('credit-banner');
  if (!banner) return;

  const { data, error } = await db
    .from('sales')
    .select('balance')
    .eq('status', 'credit');

  if (error) {
    banner.classList.add('hidden');
    return;
  }

  const sales = data ?? [];
  const total = sales.reduce((sum, sale) => sum + Number(sale.balance || 0), 0);
  const count = sales.length;

  if (total > 0) {
    banner.innerHTML = `<span>${count} client${count > 1 ? 's' : ''} owe${count === 1 ? 's' : ''} ${fmtKES(total)} in credit</span><a href="#/credits">View &amp; Settle →</a><button id="credit-banner-dismiss" aria-label="Dismiss">×</button>`;
    banner.classList.remove('hidden');
    banner.querySelector('#credit-banner-dismiss')?.addEventListener('click', () => {
      banner.classList.add('hidden');
    });
  } else {
    banner.classList.add('hidden');
    banner.innerHTML = '';
  }
}
