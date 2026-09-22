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

const VERSION = "v3";
const SHELL_CACHE = `trip-packer-shell-${VERSION}`;
const API_CACHE = `trip-packer-api-${VERSION}`;
const TILE_CACHE = `trip-packer-tiles-${VERSION}`;

/*
 * Map tiles: 256px PNGs from Esri's CDN.
 *
 * Declared here with the other cache names because `activate` filters against
 * it while evicting stale caches, and a `const` referenced above its
 * declaration only works by accident of evaluation order.
 */
const TILE_HOSTS = ["services.arcgisonline.com"];
const TILE_LIMIT = 600;

/*
 * The minimum needed to render *something* offline. Next.js fingerprints its
 * build assets, so the JS/CSS chunks cannot be listed here; they are cached at
 * runtime as they are first requested instead.
 */
const SHELL_ASSETS = ["/", "/offline"];

/**
 * Warm the cache with the shell page's own build assets, at install time.
 *
 * Why this exists rather than relying on the runtime fetch handler: the
 * service worker is registered from the page, so on the very first visit the
 * page has already requested its JS and CSS before the worker takes control.
 * clients.claim() only affects later requests, so those first-load chunks are
 * never seen by the fetch handler and nothing is cached.
 *
 * The practical consequence was that offline only worked from the second visit
 * onward. Someone who opened the app once and then lost signal — exactly the
 * airport case — got a cached HTML shell whose scripts 404'd, rendering a
 * blank page instead of their itinerary.
 *
 * So the shell is fetched here and its asset URLs pulled out of the markup.
 * Failures are swallowed on purpose: a missing chunk must degrade offline
 * support, never block the install.
 */
async function precacheShellAssets(cache) {
  try {
    const res = await fetch(new Request("/", { cache: "reload" }));
    if (!res.ok) return;
    const html = await res.clone().text();
    await cache.put(new Request("/"), res);

    const urls = new Set();

    // <script src="..."> and <link href="...">
    const attrRe = /<(?:script|link)\b[^>]*?\b(?:src|href)=["']([^"']+)["']/gi;
    let m;
    while ((m = attrRe.exec(html)) !== null) urls.add(m[1]);

    // Next.js also streams chunk paths inside the RSC payload / inline script.
    const pathRe = /"(\/_next\/static\/[^"]+\.(?:js|css))"/g;
    while ((m = pathRe.exec(html)) !== null) urls.add(m[1]);

    // Only same-origin build assets; anything else is not ours to cache.
    const targets = Array.from(urls).filter(
      (u) => u.startsWith("/_next/static/") || u.startsWith("/icons/")
    );

    await Promise.all(
      targets.map((u) =>
        cache
          .add(new Request(u, { cache: "reload" }))
          .catch(() => null) // one bad chunk must not abort the rest
      )
    );
  } catch {
    // Offline at install time, or an unexpected response shape. The runtime
    // fetch handler still populates the cache on later visits.
  }
}

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
      await precacheShellAssets(cache);
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
          .filter((k) => k !== SHELL_CACHE && k !== API_CACHE && k !== TILE_CACHE)
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

/*
 * Map tiles: 256px PNGs from Esri's CDN.
 *
 * Why this needs its own path rather than the same-origin guard below: tiles are
 * cross-origin, and Leaflet loads them with `crossOrigin: false`, so the request
 * is no-cors and the response is *opaque* -- status 0, unreadable body. A plain
 * `if (res.ok)` check is therefore false for every tile, which is why nothing
 * was ever cached and the map went blank offline even though the itinerary
 * rendered.
 *
 * An opaque response is still storable and still re-servable, which is all the
 * <img> tag needs. We deliberately do not read the body; there is nothing to
 * read and nothing to validate.
 *
 * Keyed on the exact request URL. The Esri path is /{z}/{y}/{x} -- row before
 * column, the reverse of the usual convention -- so any normalisation here
 * would risk serving valid PNGs of the wrong place.
 *
 * Cache-first, because a tile at a given z/x/y never changes. Capped, because
 * panning a map can request thousands of tiles and an unbounded cache would
 * grow without limit on a device we do not control.
 */
async function tileFetch(request) {
  const cache = await caches.open(TILE_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;

  try {
    const res = await fetch(request);
    // Opaque tiles type as "opaque" and have status 0; both are fine to store.
    if (res.ok || res.type === "opaque") {
      await cache.put(request, res.clone());
      void trimTiles(cache);
    }
    return res;
  } catch (err) {
    // Offline and never seen: let the request fail so Leaflet shows its own
    // broken-tile state rather than us inventing a blank PNG.
    throw err;
  }
}

/** Drop oldest entries once the tile cache outgrows its cap. */
async function trimTiles(cache) {
  try {
    const keys = await cache.keys();
    if (keys.length <= TILE_LIMIT) return;
    // Re-inserting a key moves it to the end, so iteration order is roughly
    // least-recently-stored first. Evicting from the front is good enough here.
    const excess = keys.length - TILE_LIMIT;
    for (let i = 0; i < excess; i++) await cache.delete(keys[i]);
  } catch {
    // Eviction is best-effort; a failure must never break a tile response.
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;

  if (request.method !== "GET") return;

  const url = new URL(request.url);

  /*
   * Map tiles are cross-origin and must be handled before the same-origin
   * guard below, which would otherwise drop every one of them.
   */
  if (TILE_HOSTS.includes(url.hostname) && url.pathname.includes("/tile/")) {
    event.respondWith(tileFetch(request));
    return;
  }

  // Same-origin only. Third-party (fonts, analytics) is left to the browser so
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
          /*
           * Prefer this exact page if we cached it. A trip the user has opened
           * before has its own entry (see the CACHE_TRIP handler), and serving
           * it is the difference between seeing the itinerary offline and
           * being dropped on the home screen.
           */
          const exact = await cache.match(new URL(request.url).pathname);
          if (exact) return exact;
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

/**
 * Cache a trip page for offline use.
 *
 * Trip pages are server-rendered per trip, so unlike the app shell they cannot
 * be listed up front — we only know which ones matter once the user opens
 * them. Without this, an offline navigation to /trips/<id> fell back to the
 * home shell, which meant the one screen worth having at an airport (the
 * itinerary with its booking references) was the one screen unavailable.
 *
 * The page is stored under its own URL so the navigation handler can find it
 * on a later offline visit. Failures are ignored: this is a warm-up, and the
 * user is by definition looking at a working page while it runs.
 */
self.addEventListener("message", (event) => {
  const data = event.data;
  if (!data || data.type !== "CACHE_TRIP" || typeof data.url !== "string") return;
  event.waitUntil(
    (async () => {
      try {
        // Same-origin trip pages only.
        const url = new URL(data.url, self.location.origin);
        if (url.origin !== self.location.origin) return;
        if (!url.pathname.startsWith("/trips/")) return;

        const cache = await caches.open(SHELL_CACHE);
        const res = await fetch(new Request(url.pathname, { cache: "reload" }));
        if (res.ok) await cache.put(new Request(url.pathname), res);
      } catch {
        // Offline, or the page could not be fetched. Nothing to do.
      }
    })()
  );
});
