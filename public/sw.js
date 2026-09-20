/*
 * Service worker.
 *
 * Two jobs:
 *   1. Precache the app shell so a cold start with no network still paints the
 *      UI (rather than Safari's "no internet" page).
 *   2. Serve API GETs network-first, falling back to the last good response.
 *
 * Deliberately NOT caching POSTs or navigations aggressively. The app is
 * server-rendered per trip, so caching a navigation response would pin one
 * user's trip HTML for everyone — a stale, and in the sharing case, private,
 * page. Navigations are network-first and only fall back to a cached shell.
 *
 * Version the cache name: bumping it is what evicts the previous shell, since
 * there is no other invalidation hook.
 */

const VERSION = "v1";
const SHELL_CACHE = `trip-packer-shell-${VERSION}`;
const API_CACHE = `trip-packer-api-${VERSION}`;

/*
 * The minimum needed to render *something* offline. Next.js fingerprints its
 * build assets, so the JS/CSS chunks cannot be listed here; they are cached at
 * runtime as they are first requested instead.
 */
const SHELL_ASSETS = ["/", "/offline"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      // Individually so one 404 cannot abort the whole install.
      await Promise.all(
        SHELL_ASSETS.map((url) =>
          cache.add(new Request(url, { cache: "reload" })).catch(() => null)
        )
      );
      await self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => k !== SHELL_CACHE && k !== API_CACHE)
          .map((k) => caches.delete(k))
      );
      await self.clients.claim();
    })()
  );
});

/** Network-first: fresh data when online, last known when not. */
async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(request);
    // Only cache real successes. Caching a 404 or a 500 would serve that
    // failure back later as though it were data.
    if (res.ok) cache.put(request, res.clone());
    return res;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;
    throw new Error("offline and not cached");
  }
}

/** Cache-first: build assets are content-addressed and safe to reuse. */
async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  const res = await fetch(request);
  if (res.ok) cache.put(request, res.clone());
  return res;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;

  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Same-origin only. Third-party (map tiles, fonts) is left to the browser so
  // we never serve a cross-origin response we are not allowed to hand back.
  if (url.origin !== self.location.origin) return;

  // Next.js static chunks and images: immutable, cache-first.
  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/")) {
    event.respondWith(cacheFirst(request, SHELL_CACHE));
    return;
  }

  // API reads: network-first with the last good response as fallback.
  if (url.pathname.startsWith("/api/")) {
    event.respondWith(networkFirst(request, API_CACHE));
    return;
  }

  // Navigations and everything else: network-first, fall back to the shell so
  // an offline deep link still opens the app instead of a browser error.
  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          return await fetch(request);
        } catch {
          const cache = await caches.open(SHELL_CACHE);
          const shell = (await cache.match("/")) || (await cache.match("/offline"));
          if (shell) return shell;
          throw new Error("offline");
        }
      })()
    );
    return;
  }

  event.respondWith(networkFirst(request, SHELL_CACHE));
});
