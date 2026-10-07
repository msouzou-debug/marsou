/* Clean Shot service worker — installability + offline.
   Network-first for pages (so updates show online), cache-first for assets.
   CACHE is stamped with the app version by tools/release.py, so every release
   is a changed sw.js: the browser installs it and the old cache is dropped. */
const CACHE = "clean-shot-1.48";
const ASSETS = ["./", "index.html", "install.html", "manifest.webmanifest",
  "apple-touch-icon.png", "icon-192.png", "icon-512.png"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys()
    .then(ks => Promise.all(ks.map(k => k === CACHE ? null : caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  if (req.mode === "navigate") {
    // Bypass the browser's HTTP cache too — GitHub Pages lets it hold a page for
    // ten minutes, which is how an old build kept showing after a release.
    const url = new URL(req.url); url.search = "";
    e.respondWith(
      fetch(req.url, { cache: "no-store" })
        .then(r => {
          if (r.ok) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(url.toString(), copy)); }
          return r;
        })
        .catch(() => caches.match(url.toString()).then(r => r || caches.match("index.html")))
    );
    return;
  }
  e.respondWith(caches.match(req).then(r => r || fetch(req)));
});
