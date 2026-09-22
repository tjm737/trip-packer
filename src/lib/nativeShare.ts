/*
 * Sharing a trip link.
 *
 * The problem this module exists to solve: the app ships in two places at once.
 * On the web it is an ordinary Next.js site, and inside the iOS app it is a
 * Capacitor shell whose WebView loads the same site from
 * https://trips.planetracker.app. `navigator.share` exists in an iOS Safari tab
 * but is unreliable inside the Capacitor WebView (WKWebView hands nothing to the
 * OS share sheet there), so a web-only implementation means tapping "Share"
 * inside the app does nothing at all — the single most visible feature of a
 * travel app, silently broken on the platform where people actually use it.
 *
 * So there are three layers, tried in order:
 *
 *   1. @capacitor/share, but ONLY reached through a dynamic import().
 *      A static `import { Share } from "@capacitor/share"` would be bundled
 *      into the browser build, and on the web the plugin's web implementation
 *      is a thin wrapper that throws "not implemented" — which would then have
 *      to be caught anyway. Dynamic import keeps it out of the desktop bundle
 *      entirely and means a plain browser never even loads the module.
 *
 *   2. navigator.share (the Web Share API), for mobile Safari/Chrome.
 *
 *   3. navigator.clipboard.writeText, because desktop browsers mostly have no
 *      share sheet, and a copied link is far more useful than a dead button.
 *
 * The delicate part is CANCELLATION, and it is the reason this file has more
 * comments than code.
 *
 * When a user dismisses the iOS share sheet — which they do constantly, it is a
 * normal action, not an edge case — the promise rejects. In the Web Share API
 * that rejection is a DOMException with name "AbortError"; from Capacitor it
 * comes back as a plain Error whose message is "Share canceled". If that were
 * treated as a failure, two things would go wrong, and both are real bugs:
 *
 *   - The clipboard fallback would fire, so cancelling the share sheet would
 *     silently overwrite whatever the user last copied. It looks like nothing
 *     happened, and their clipboard is gone.
 *
 *   - The caller would show an error toast for an action the user chose. Being
 *     told "Couldn't share" right after deliberately closing the sheet is
 *     baffling.
 *
 * Cancellation is therefore its own outcome: ok:false, a `canceled` marker, no
 * clipboard fallback, and no console.error. Only a genuine throw — a plugin
 * that is missing, a rejected permission, anything else — falls through to the
 * next layer.
 *
 * SSR safety: this is imported by a client component, but Next.js still renders
 * client components on the server, so the module body must not touch `window`
 * or `navigator` at import time. Every browser global is read inside the
 * function, behind a typeof guard.
 */

export type ShareMethod = "native" | "web" | "clipboard" | "none";

export interface ShareLinkInput {
  title?: string;
  url: string;
  text?: string;
}

export interface ShareLinkResult {
  ok: boolean;
  method: ShareMethod;
  /**
   * True only when the user dismissed the share sheet themselves. Callers can
   * use this to stay silent, where a real failure would deserve a message.
   */
  canceled?: boolean;
  error?: string;
}

/**
 * True when the thrown value represents the user dismissing a share sheet
 * rather than an actual failure.
 *
 * Two shapes have to be recognised because the two layers report it
 * differently: the Web Share API rejects with a DOMException named
 * "AbortError", while @capacitor/share rejects with an Error whose message is
 * "Share canceled" (the plugin does not set a name we can key off).
 */
function isCancellation(err: unknown): boolean {
  if (!err) return false;

  const name = (err as { name?: unknown }).name;
  if (name === "AbortError") return true;

  const message = (err as { message?: unknown }).message;
  if (typeof message === "string" && /cancel(l)?ed/i.test(message)) return true;

  return false;
}

/**
 * Opens the platform share sheet for `url`, or copies it to the clipboard when
 * no share sheet is available.
 *
 * Never throws: every path resolves to a result object, so a caller can post a
 * toast without wrapping the call in try/catch. `ok:false` means "no method
 * succeeded"; check `canceled` before reporting that to the user.
 */
export async function shareLink(input: ShareLinkInput): Promise<ShareLinkResult> {
  const { title = "", url, text = "" } = input;

  /* -- 1. native Capacitor share sheet ---------------------------------- */

  /*
   * The dynamic import is wrapped so a missing/never-built plugin is a caught
   * error rather than a module-load crash. On the web this import resolves to
   * the plugin's web shim (or fails outright depending on the bundler), which
   * is exactly why it is never attempted unless we are inside the native app.
   *
   * Capacitor.getPlatform() is the supported way to tell: it returns "web" in a
   * browser and "ios"/"android" natively. We import @capacitor/core lazily too,
   * for the same bundle-weight reason, and treat any failure to load it as "not
   * native" — the worst case is falling through to the Web Share API, which is
   * correct behaviour in a browser and never reached in the app.
   */
  try {
    const core = await import("@capacitor/core");
    const platform = core.Capacitor?.getPlatform?.() ?? "web";

    if (platform !== "web" && typeof window !== "undefined") {
      const { Share } = await import("@capacitor/share");
      await Share.share({ title, url, text, dialogTitle: title });
      return { ok: true, method: "native" };
    }
  } catch (err) {
    if (isCancellation(err)) {
      // The user closed the sheet. Not an error, and critically NOT a reason to
      // clobber their clipboard with the link.
      return { ok: false, method: "native", canceled: true };
    }
    // A real failure (plugin missing, bridge error). Fall through to the next
    // layer rather than reporting a dead end — the Web Share API may still
    // work.
  }

  /* -- 2. Web Share API -------------------------------------------------- */

  /*
   * Guarded with typeof because this runs during SSR too, and because
   * `navigator.share` is absent on desktop Firefox and most desktop Chrome.
   * Note that Safari only exposes it on a secure origin, so http://localhost
   * works while a bare http:// LAN address does not.
   */
  if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
    try {
      await navigator.share({ title, url, text });
      return { ok: true, method: "web" };
    } catch (err) {
      if (isCancellation(err)) {
        return { ok: false, method: "web", canceled: true };
      }
      // A genuine failure here (e.g. no transient activation, bad payload) is
      // worth one more attempt via the clipboard.
    }
  }

  /* -- 3. clipboard ------------------------------------------------------ */

  /*
   * The last resort, and the only path that works on a desktop browser with no
   * share sheet. `navigator.clipboard` is undefined on insecure origins, so the
   * guard is load-bearing: without it a plain http:// deployment throws a
   * TypeError on a missing property instead of reporting an honest failure.
   */
  if (
    typeof navigator !== "undefined" &&
    navigator.clipboard &&
    typeof navigator.clipboard.writeText === "function"
  ) {
    try {
      await navigator.clipboard.writeText(url);
      return { ok: true, method: "clipboard" };
    } catch (err) {
      return {
        ok: false,
        method: "clipboard",
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /* -- 4. nothing available --------------------------------------------- */

  /*
   * Reached on an old browser, an insecure origin, or in SSR/Node where none of
   * the browser globals exist. Reported honestly rather than throwing, so a
   * server render that happens to call this does not blow up the page.
   */
  return { ok: false, method: "none" };
}
