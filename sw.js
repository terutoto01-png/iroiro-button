// いろいろボタン Service Worker
// ・更新が頻繁でも古いキャッシュが残らない設計
// ・HTML は network-first、バージョン付きアセットは cache-first

const CACHE_PREFIX = 'iroiro';
const CORE_CACHE = `${CACHE_PREFIX}-core-v14`;
const RUNTIME_CACHE = `${CACHE_PREFIX}-runtime`;

// 初回インストール時に確実に持っておくアプリシェル
// この配列を変えるたびに CORE_CACHE の番号を上げること
const CORE_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './common.css?v=11',
  './common.js?v=12',
  './game.js?v=2',
  './gpu-particles.js?v=3',
  './field-scene.js?v=2',
  './icon-192.png',
  './icon-512.png',
  './maskable-icon-512.png',
];

// ランタイムキャッシュの上限（エントリ数）
const RUNTIME_LIMIT = 200;

// ---- インストール: core をキャッシュして即座に有効化 ----
self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CORE_CACHE)
      .then(c => c.addAll(CORE_ASSETS))
      .catch(err => console.error('[sw] precache failed', err))
  );
});

// ---- 有効化: 古い core キャッシュだけ削除、runtime は残す ----
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k.startsWith(CACHE_PREFIX) && k !== CORE_CACHE && k !== RUNTIME_CACHE)
          .map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
  // すべてのクライアントに「更新完了」を通知
  notifyClients('UPDATE_READY');
});

// ---- fetch 戦略 ----
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return;

  const isHTML = e.request.mode === 'navigate' || url.pathname.endsWith('.html');
  const isVersioned = url.searchParams.has('v');

  if (isHTML) {
    // HTML は必ず最新を取りに行く。オフラインならキャッシュを返す。
    e.respondWith(networkFirst(e.request, CORE_CACHE));
  } else if (isVersioned) {
    // ?v= が付いたアセットは URL が変わらない限り不変なのでキャッシュ優先
    e.respondWith(cacheFirst(e.request, RUNTIME_CACHE));
  } else {
    // その他（アイコン、manifest など）は使いながら裏で更新
    e.respondWith(staleWhileRevalidate(e.request, RUNTIME_CACHE));
  }
});

async function networkFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    // ブラウザの HTTP キャッシュ（GitHub Pages は 10分）を とおさず、かならず サーバーに たしかめる
    const res = await fetch(req.url, { cache: 'no-cache', credentials: 'same-origin' });
    if (res && res.status === 200) {
      await cache.put(req, res.clone());
    }
    return res;
  } catch (err) {
    const cached = await cache.match(req);
    if (cached) return cached;
    // どちらも失敗したらシンプルなオフライン応答
    return new Response('オフラインです', { status: 503, headers: { 'Content-Type': 'text/plain;charset=utf-8' } });
  }
}

async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const cached = await cache.match(req);
    if (cached) return cached;
    const res = await fetch(req);
    if (res && res.status === 200) {
      await cache.put(req, res.clone());
      await trimCache(cacheName);
    }
    return res;
  } catch (err) {
    return new Response('', { status: 503 });
  }
}

async function staleWhileRevalidate(req, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const cached = await cache.match(req);
    const network = fetch(req).then(async (res) => {
      if (res && res.status === 200) {
        await cache.put(req, res.clone());
        await trimCache(cacheName);
      }
      return res;
    }).catch(() => cached);
    return cached || network || new Response('', { status: 503 });
  } catch (err) {
    return new Response('', { status: 503 });
  }
}

// ランタイムキャッシュが大きくなりすぎたら古いものを削除
async function trimCache(cacheName) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length > RUNTIME_LIMIT) {
    const toDelete = keys.slice(0, keys.length - RUNTIME_LIMIT + 50);
    await Promise.all(toDelete.map(req => cache.delete(req)));
  }
}

function notifyClients(type) {
  self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
    clients.forEach(c => c.postMessage({ type }));
  });
}
