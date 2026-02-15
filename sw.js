
const CACHE = "metin-villo2-v0.0-revisioned-realtime-debug";
const ASSETS = [
  "./index.html",
  "./app.js",
  "./firebase-config.js",
  "./manifest.json",
  "./sw.js",
  "./villo2.png",
  "./icon-192.png",
  "./icon-512.png",
];

self.addEventListener("install", (e)=>{
  e.waitUntil((async()=>{
    const c = await caches.open(CACHE);
    await c.addAll(ASSETS);
    self.skipWaiting();
  })());
});

self.addEventListener("activate", (e)=>{
  e.waitUntil((async()=>{
    const keys = await caches.keys();
    await Promise.all(keys.map(k => (k === CACHE) ? null : caches.delete(k)));
    self.clients.claim();
  })());
});

self.addEventListener("fetch", (e)=>{
  e.respondWith((async()=>{
    const cached = await caches.match(e.request);
    if (cached) return cached;
    try {
      const fresh = await fetch(e.request);
      return fresh;
    } catch {
      if (e.request.mode === "navigate") return caches.match("./index.html");
      throw;
    }
  })());
});
