const CACHE_NAME = 'esp-control-cache-v1';
const URLS_TO_CACHE = [
  '/control',
  '/styles.css',
  '/js/pin-control.js'
  // Примітка: іконки також кешуються, але їх кешування менш критичне.
  // '/images/icon-192x192.png',
  // '/images/icon-512x512.png'
];

/**
 * Подія встановлення: відкриває кеш та додає основні файли оболонки додатку.
 */
self.addEventListener('install', (event) => {
  console.log('Service Worker: Installing...');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('Service Worker: Caching app shell');
        // Ми використовуємо {cache: 'reload'} щоб переконатися, що завантажуємо свіжі файли з мережі, а не з HTTP-кешу браузера.
        const cachePromises = URLS_TO_CACHE.map(url => {
            return fetch(new Request(url, {cache: 'reload'})).then(response => {
                if (response.ok) {
                    return cache.put(url, response);
                }
                return Promise.reject(`Failed to fetch and cache ${url}`);
            });
        });
        return Promise.all(cachePromises);
      })
      .then(() => {
        console.log('Service Worker: Installation complete.');
        return self.skipWaiting(); // Активуємо новий SW одразу
      })
  );
});

/**
 * Подія fetch: перехоплює мережеві запити та повертає відповіді з кешу, якщо вони там є.
 * В іншому випадку, виконує запит до мережі.
 */
self.addEventListener('fetch', (event) => {
  // Ми не кешуємо API запити або SSE, тільки статичні ресурси
  if (event.request.url.includes('/api/') || event.request.url.includes('/events')) {
    return;
  }

  event.respondWith(
    caches.match(event.request)
      .then(response => response || fetch(event.request))
  );
});