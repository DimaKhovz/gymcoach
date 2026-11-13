// Офлайн-кэш: приложение открывается в зале и без интернета.
const CACHE = 'gymcoach-v2';
const FILES = ['./', 'index.html', 'css/style.css', 'js/app.js', 'js/engine.js', 'js/parser.js', 'js/media.js',
  'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png',
  'data/mapping.json', 'data/instructions-en.json', 'data/instructions-ru.json', 'data/exdb-index.json'];

// Встроенные кадры упражнений тоже кладём в кэш сразу, чтобы в зале всё было без интернета.
async function precache() {
  const c = await caches.open(CACHE);
  await c.addAll(FILES);
  const info = await (await c.match('data/instructions-en.json')).json();
  const imgs = Object.values(info).flatMap(x => [`img/ex/${x.file}-0.webp`, `img/ex/${x.file}-1.webp`]);
  await c.addAll(imgs);
}

self.addEventListener('install', e => {
  e.waitUntil(precache().then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// Сначала сеть (чтобы обновления доходили), без сети — из кэша.
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request, { cache: 'no-cache' })
      .then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});
