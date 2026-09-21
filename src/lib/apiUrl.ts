/*
 * Absolute-URL helper for the client's own API calls.
 *
 * ROOT CAUSE OF THE "stuck on Loading trip..." HANG:
 * the client called `fetch("/api/state")` with a RELATIVE url. A relative url
 * is resolved against the document's base URL, not against "the server". In a
 * normal browser tab the base is the site root, so "/api/state" happens to
 * work. In the Capacitor iOS WebView the app is served from a different
 * base/origin, and when the app is opened on a deep path such as /trips/<id>
 * the relative URL resolves against that path's directory
 * (e.g. file:///trips/api/state or http://host/trips/api/state) instead of the
 * root. The request hits a URL that does not exist and never settles, so the
 * page waits forever on its loading state.
 *
 * Deriving the URL from `window.location.origin` pins the request to the real
 * server no matter which page the app is on.
 *
 * Kept in its own module (rather than inside storage.ts) so UI components and
 * tests can use it without pulling in the whole data layer.
 */

/**
 * Returns an absolute URL for `path` based on the current page origin.
 *
 * On the server (SSR/Node, no `window`) there is no origin to resolve against,
 * so the root-relative path is returned unchanged. This keeps the helper safe
 * to call from code that may run during SSR.
 */
export function apiUrl(path: string): string {
  if (typeof window === "undefined" || !window.location?.origin) return path;
  return new URL(path, window.location.origin).toString();
}
