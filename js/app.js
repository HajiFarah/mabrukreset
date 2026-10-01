import { initRouter } from './router.js';
import { refreshBanner } from './components/banner.js';
import { db } from './supabase.js';
import { renderLogin } from './pages/login.js';

// ── PWA install prompt ────────────────────────────────────────────────────────
let _installPrompt = null;

const installBtn = document.getElementById('pwa-install-btn');

// Hide if already running as installed PWA
if (window.matchMedia('(display-mode: standalone)').matches) {
  installBtn?.classList.add('hidden');
} else {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    _installPrompt = e;
    installBtn?.classList.remove('hidden');
  });
}

installBtn?.addEventListener('click', async () => {
  if (!_installPrompt) return;
  installBtn.disabled = true;
  const { outcome } = await _installPrompt.prompt();
  if (outcome === 'accepted') {
    installBtn.classList.add('hidden');
  } else {
    installBtn.disabled = false;
  }
  _installPrompt = null;
});

window.addEventListener('appinstalled', () => {
  installBtn?.classList.add('hidden');
  _installPrompt = null;
});

async function startApp() {
  const sidebar = document.getElementById('sidebar');
  sidebar.classList.add('hidden');
  document.body.classList.add('login-mode');

  const { data, error } = await db.auth.getSession();
  if (error || !data.session) {
    renderLogin();
    return;
  }

  sidebar.classList.remove('hidden');
  document.body.classList.remove('login-mode');
  initRouter();
  await refreshBanner();
}

// Select-all on focus for every number input — no manual deleting of 0s
document.addEventListener('focus', (e) => {
  if (e.target.matches('input[type="number"]')) e.target.select();
}, true);

startApp();
