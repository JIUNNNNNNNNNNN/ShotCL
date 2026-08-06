const CACHE_NAME = "today-storyboard-progress-v2";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(["/", "/manifest.webmanifest", "/icon.svg"]))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);

  if (
    request.method !== "GET"
    || request.mode === "navigate"
    || url.origin !== self.location.origin
    || url.pathname.startsWith("/api/")
    || url.pathname.startsWith("/invite/")
  ) {
    return;
  }

  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      try {
        const response = await fetch(request);
        const cacheControl = response.headers.get("cache-control")?.toLowerCase() ?? "";
        if (
          response.ok
          && !cacheControl.includes("no-store")
          && !cacheControl.includes("private")
        ) {
          await cache.put(request, response.clone());
        }
        return response;
      } catch {
        return cache.match(request);
      }
    })
  );
});
