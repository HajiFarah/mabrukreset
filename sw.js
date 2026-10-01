const CACHE_NAME = 'mabruk-gs-v2';
const APP_FILES = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/css/base.css',
  '/css/layout.css',
  '/css/components.css',
  '/js/app.js',
  '/js/router.js',
  '/js/supabase.js',
  '/js/config.js',
  '/js/utils.js',
  '/js/pages/sell.js',
  '/js/pages/stockIn.js',
  '/js/pages/products.js',
  '/js/pages/suppliers.js',
  '/js/pages/supplierDetail.js',
  '/js/pages/credits.js',
  '/js/pages/salesHistory.js',
  '/js/pages/financial.js',
  '/js/pages/login.js',
  '/js/services/suppliers.js',
  '/js/services/products.js',
  '/js/services/sales.js',
  '/js/services/credits.js',
  '/js/services/financial.js',
  '/js/components/toast.js',
  '/js/components/modal.js',
  '/js/components/banner.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_FILES))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const requestUrl = new URL(event.request.url);
  const isExternal = requestUrl.hostname.endsWith('supabase.co')
    || requestUrl.hostname === 'esm.sh'
    || requestUrl.hostname.endsWith('.esm.sh')
    || requestUrl.hostname === 'fonts.googleapis.com'
    || requestUrl.hostname === 'fonts.gstatic.com';

  if (isExternal || event.request.method !== 'GET') {
    event.respondWith(fetch(event.request));
    return;
  }

  // Network-first for JS, CSS, HTML so code changes are always picked up
  const isAppFile = APP_FILES.some((path) => requestUrl.pathname === path || requestUrl.pathname === path + '/');
  if (isAppFile) {
    event.respondWith(
      fetch(event.request)
        .then((networkResponse) => {
          if (networkResponse.ok) {
            const clone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return networkResponse;
        })
        .catch(() => caches.match(event.request).then((cached) => cached || new Response(
          '<h1>You are offline</h1><p>Connect to the internet to use Mabruk GS.</p>',
          { headers: { 'Content-Type': 'text/html' } },
        ))),
    );
    return;
  }

  // Cache-first for everything else (icons, images)
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) return cachedResponse;
      return fetch(event.request).then((networkResponse) => {
        if (networkResponse.ok) {
          const clone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return networkResponse;
      }).catch(() => new Response(
        '<h1>You are offline</h1><p>Connect to the internet to use Mabruk GS.</p>',
        { headers: { 'Content-Type': 'text/html' } },
      ));
    }),
  );
});
