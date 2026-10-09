const STATIC_CACHE = "stargram-static-v8";
const DYNAMIC_CACHE = "stargram-dynamic-v8";
const MAX_DYNAMIC_CACHE_SIZE = 50;

const ASSETS = [self.origin + "/"];

const limitCacheSize = async (cacheName, maxSize) => {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length > maxSize) {
    await cache.delete(keys[0]);
    await limitCacheSize(cacheName, maxSize);
  }
};

const isCacheableResponse = (response) => {
  const cacheControl = response.headers.get("cache-control") || "";
  return response.ok
    && !/private|no-store/i.test(cacheControl);
};

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(STATIC_CACHE);
      for (const asset of ASSETS) {
        try {
          const response = await fetch(asset, { cache: "no-store" });
          if (isCacheableResponse(response)) {
            await cache.put(asset, response.clone());
          }
        } catch (error) {
          console.warn("Failed to cache:", asset, error);
        }
      }
    })()
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== STATIC_CACHE && key !== DYNAMIC_CACHE)
            .map((key) => caches.delete(key))
        )
      )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;
  if (event.request.method !== "GET") return;

  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      caches.open(STATIC_CACHE).then(async (cache) => {
        const cachedResponse = await cache.match(event.request);
        if (cachedResponse) return cachedResponse;

        try {
          const response = await fetch(event.request);
          if (isCacheableResponse(response)) {
            await cache.put(event.request, response.clone());
          }
          return response;
        } catch (error) {
          console.warn("Failed to fetch:", event.request.url);
          return new Response("", { status: 404 });
        }
      })
    );
    return;
  }

  if (url.pathname.match(/\.(woff2?|ttf|png|jpg|jpeg|gif|svg|json)$/)) {
    event.respondWith(
      caches.open(DYNAMIC_CACHE).then(async (cache) => {
        const cachedResponse = await cache.match(event.request);
        if (cachedResponse) return cachedResponse;

        try {
          const response = await fetch(event.request);
          if (isCacheableResponse(response)) {
            await cache.put(event.request, response.clone());
            await limitCacheSize(DYNAMIC_CACHE, MAX_DYNAMIC_CACHE_SIZE);
          }
          return response;
        } catch (error) {
          console.warn("Failed to fetch:", event.request.url);
          return new Response("", { status: 404 });
        }
      })
    );
    return;
  }

  // Do not cache authenticated/unknown application routes.
  if (url.pathname !== "/") return;

  event.respondWith(networkFirst(event.request));
});

const networkFirst = async (request) => {
  try {
    const response = await fetch(request);
    if (isCacheableResponse(response)) {
      const cache = await caches.open(DYNAMIC_CACHE);
      await cache.put(request, response.clone());
      await limitCacheSize(DYNAMIC_CACHE, MAX_DYNAMIC_CACHE_SIZE);
    }
    return response;
  } catch (error) {
    console.warn("Network request failed, serving from cache:", request.url);
    const cached = await caches.match(request);
    return cached || new Response("Offline", { status: 503 });
  }
};

self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") {
    self.skipWaiting();
  }
});
