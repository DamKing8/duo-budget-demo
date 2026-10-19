/* Minimal install shell. Network first, then the copy saved on this device. Does not cache Supabase or exchange rates. */
var CACHE = 'duo-budget-shell-1';
var SHELL = ['./', './index.html', './manifest.webmanifest', './supabase.js'];

self.addEventListener('install', function (event) {
  event.waitUntil(caches.open(CACHE).then(function (cache) {
    return cache.addAll(SHELL).catch(function () { return null; });
  }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (event) {
  event.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET') return;
  var url;
  try { url = new URL(req.url); } catch (e) { return; }
  if (url.origin !== self.location.origin) return;
  event.respondWith(fetch(req).then(function (res) {
    if (res && res.ok && url.pathname.indexOf('/icons/') === 0 || res && res.ok && /\.(html|js|webmanifest|css|png|webp|ico)$/.test(url.pathname)) {
      var copy = res.clone();
      caches.open(CACHE).then(function (cache) { cache.put(req, copy); });
    }
    return res;
  }).catch(function () {
    return caches.match(req).then(function (hit) { return hit || caches.match('./index.html'); });
  }));
});
