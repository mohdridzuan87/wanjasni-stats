// Network first, so updates show up straight away; the saved copy is only used when offline.
const CACHE = "wj-stats-v2";
const SHELL = ["./", "index.html", "style.css", "map.js", "app.js", "manifest.webmanifest", "fonts/Inter.ttf", "icons/icon-192.png"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith("wj-stats-") && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", e => {
  const { request } = e;
  // Only the app's own files are cached. Data requests to other addresses are never stored here.
  if (request.method !== "GET" || new URL(request.url).origin !== location.origin) return;
  e.respondWith(fetch(request)
    .then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(request, copy)); }
      return res;
    })
    .catch(() => caches.match(request, { ignoreSearch: true })));
});
