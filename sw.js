const CACHE = "metin-villo2-cache-v1";
const ASSETS = [
  "./index.html",
  "./app.js",
  "./manifest.json",
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
  const req = e.request;
  e.respondWith((async()=>{
    const cached = await caches.match(req);
    if (cached) return cached;
    try{
      return await fetch(req);
    }catch{
      if (req.mode === "navigate") return caches.match("./index.html");
      throw;
    }
  })());
});
