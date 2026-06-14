/* Minimal offline service worker. Cache-first for the app shell + assets,
   network-first for the program data so updates land while staying usable
   offline. Cross-origin (maps, Wikipedia) is never cached. */
const CACHE = "lfm-v5";

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.add(self.registration.scope)).then(() => self.skipWaiting()).catch(() => {}));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return; // leave maps/wikipedia/etc. alone

  const put = (r) => { const cp = r.clone(); caches.open(CACHE).then((c) => c.put(req, cp)); return r; };

  if (url.pathname.includes("/data/")) { // program data — network-first
    e.respondWith(fetch(req).then(put).catch(() => caches.match(req)));
    return;
  }
  if (req.mode === "navigate") { // app shell — network-first, fall back offline
    e.respondWith(fetch(req).then(put).catch(() => caches.match(req).then((c) => c || caches.match(self.registration.scope))));
    return;
  }
  // assets (js/css/fonts/icons) — stale-while-revalidate
  e.respondWith(caches.match(req).then((c) => {
    const net = fetch(req).then(put).catch(() => c);
    return c || net;
  }));
});
