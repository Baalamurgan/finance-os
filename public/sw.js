// Minimal service worker for Family Finance OS PWA.
// - Precaches the app shell + icons for installability/offline launch.
// - Navigations + RSC data fetches: network-first (always try fresh data),
//   fall back to cache only when offline. This is what keeps edits from
//   appearing stale: router.refresh()/tab switches fetch RSC payloads
//   (`?_rsc=…`) that must NEVER be served cache-first.
// - Static assets (content-hashed chunks, icons): cache-first (immutable → fast).
// Bump CACHE on each deploy to evict any previously poisoned entries.
const CACHE = "finance-os-v3";
const SHELL = ["/", "/manifest.webmanifest", "/icon-192.png", "/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

// Let the page tell us to activate a waiting SW immediately (update toast → Refresh).
self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // never touch auth or API — always straight to network
  if (url.pathname.startsWith("/api/")) return;

  // Dynamic content = anything that renders DB data: full-page navigations AND
  // the App Router's RSC data fetches (router.refresh / tab switch / prefetch,
  // identified by the `_rsc` query param or the `RSC` header). These are
  // network-first so a fresh edit is never masked by a cached payload. We do
  // NOT write RSC payloads to the cache: they're per-query, build-hashed, and
  // would both accumulate unbounded and risk serving stale data offline.
  const isNavigation = req.mode === "navigate";
  const isRscData = url.searchParams.has("_rsc") || req.headers.get("RSC") === "1";

  if (isNavigation) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          // Only cache a clean 200. Never cache a REDIRECTED response (an auth/lock
          // bounce) under the original URL — replaying it offline would strand the
          // user on the wrong page (e.g. a lock screen served for /personal/expenses).
          if (res.ok && !res.redirected) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => caches.match(req).then((r) => r || caches.match("/")))
    );
    return;
  }

  if (isRscData) {
    event.respondWith(fetch(req).catch(() => caches.match(req)));
    return;
  }

  // static assets: cache-first (immutable, content-hashed)
  event.respondWith(
    caches.match(req).then((cached) => cached || fetch(req).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
      return res;
    }))
  );
});
