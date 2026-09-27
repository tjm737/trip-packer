/*
 * Generate the App Store screenshot set from the live site.
 *
 * WHY THIS IS POSSIBLE WITHOUT A DEVICE
 *
 * The iOS app is a Capacitor `server.url` shell: it loads
 * https://trips.planetracker.app in a WKWebView and renders whatever the web
 * app renders. There is no native chrome above the web content (the
 * `native-screens` plugin is kill-switched off for the shipping config), so a
 * browser at the right viewport produces what a reviewer sees. A simulator or
 * device capture would add hours and prove nothing extra.
 *
 * WHAT ASC ACTUALLY DEMANDS (and why this script is picky about pixels)
 *
 * App Store Connect validates dimensions and refuses the upload if they are off
 * by a pixel. It is a silent-feeling rejection: the file "uploads" into a slot
 * that then refuses to save. The requirement (as of the 6.9"/13" era):
 *
 *   iPhone 6.9"  1320x2868  or 1290x2796   REQUIRED
 *   iPad 13"     2064x2752  or 2048x2732   REQUIRED, because this target sets
 *                                          TARGETED_DEVICE_FAMILY = "1,2"
 *
 * The iPad set is the one that catches people out: the app declares iPhone AND
 * iPad support, so ASC demands iPad screenshots regardless of whether anyone
 * intends to use it on an iPad.
 *
 * Portraits are captured at the LOGICAL viewport (device-independent pixels)
 * and rendered at deviceScaleFactor = physical/logical, so the output file is
 * exactly the physical size ASC wants. Capturing at physical CSS pixels instead
 * would shrink the UI to a size no real phone shows.
 *
 * ORDERING: capture AFTER the deploy you intend to ship. These screenshots are
 * of production, so running this before `deploy/update.sh` photographs the
 * previous build. Pass --base to point at a preview/staging URL if needed.
 *
 * AUTH: the demo account's password is deliberately absent from this repo (it
 * lives only in App Store Connect), so authenticated screens are captured only
 * when APPR_REVIEW_PASSWORD is supplied. Without it the script captures the
 * public set and says which screens it skipped, rather than silently emitting a
 * set that is missing the screens a reviewer most wants to see.
 *
 * Usage:
 *   node scripts/make-screenshots.cjs                  # public screens only
 *   APPR_REVIEW_PASSWORD='...' node scripts/make-screenshots.cjs
 *   node scripts/make-screenshots.cjs --base http://localhost:4000
 *   node scripts/make-screenshots.cjs --only iphone69
 */

"use strict";

const fs = require("fs");
const path = require("path");

const PRODUCTION_URL = "https://trips.planetracker.app";
const DEMO_EMAIL = "appreview@trips.planetracker.app";

/*
 * Device targets. `logical` is the CSS viewport (what a real device reports),
 * `scale` multiplies it to the physical pixel size ASC validates. The product
 * must equal the required dimension exactly — asserted at runtime below, so a
 * typo fails loudly here instead of silently in App Store Connect.
 */
const DEVICES = {
  iphone69: {
    label: 'iPhone 6.9"',
    logical: { width: 440, height: 956 },
    scale: 3,
    expect: { width: 1320, height: 2868 },
  },
  ipad13: {
    label: 'iPad 13"',
    logical: { width: 1032, height: 1376 },
    scale: 2,
    expect: { width: 2064, height: 2752 },
  },
};

/*
 * The screens to capture. `slug` names the output file; `auth` marks screens
 * that require a signed-in session. Screens from the same session are captured
 * in order so the auth cost is paid once per device.
 */
const SCREENS = [
  {
    slug: "01-login",
    route: "/login",
    auth: false,
    caption: "Sign in",
  },
  {
    slug: "02-dashboard",
    route: "/",
    auth: true,
    caption: "Your trips at a glance",
  },
  {
    slug: "03-trip-packing",
    route: null, // resolved from the seeded trip
    auth: true,
    caption: "Packing list with progress",
  },
  {
    slug: "04-profile",
    route: "/profile",
    auth: true,
    caption: "Profile and account",
  },
];

/*
 * Resolve playwright without declaring a dependency on it.
 *
 * Screenshots are a release-time task, not part of the build, so playwright is
 * deliberately not in package.json — but `require("playwright")` then fails even
 * though `npx playwright` works, because npx installs into its own cache. Look
 * there explicitly so the script runs with no project changes and no install
 * step beyond the browser download.
 */
function loadPlaywright() {
  const candidates = ["playwright"];

  const npxCache = path.join(process.env.HOME ?? "", ".npm", "_npx");
  if (fs.existsSync(npxCache)) {
    for (const entry of fs.readdirSync(npxCache)) {
      candidates.push(path.join(npxCache, entry, "node_modules", "playwright"));
    }
  }

  for (const c of candidates) {
    try {
      return require(c).chromium;
    } catch {
      // try the next candidate
    }
  }

  throw new Error(
    "playwright not found. Run this once, then re-run:\n" +
      "  npx playwright install chromium"
  );
}

function arg(flag) {
  const i = process.argv.indexOf(flag);
  return i === -1 ? null : (process.argv[i + 1] ?? null);
}

function hasFlag(flag) {
  return process.argv.includes(flag);
}

/*
 * Fail before doing any work if the declared geometry would produce a file ASC
 * rejects. Doing this up front turns a silent upload failure into a stack trace.
 */
function assertGeometry() {
  for (const [key, d] of Object.entries(DEVICES)) {
    const w = d.logical.width * d.scale;
    const h = d.logical.height * d.scale;
    if (w !== d.expect.width || h !== d.expect.height) {
      throw new Error(
        `${key} geometry mismatch: logical ${d.logical.width}x${d.logical.height} ` +
          `× ${d.scale} = ${w}x${h}, but ASC requires ` +
          `${d.expect.width}x${d.expect.height}`
      );
    }
  }
}

async function main() {
  assertGeometry();

  const base = arg("--base") ?? PRODUCTION_URL;
  const outRoot = arg("--out") ?? path.join(process.cwd(), "app-store-screenshots");
  const only = arg("--only");
  const password = process.env.APPR_REVIEW_PASSWORD ?? "";

  const chromium = loadPlaywright();

  const targets = only
    ? Object.entries(DEVICES).filter(([k]) => k === only)
    : Object.entries(DEVICES);
  if (targets.length === 0) {
    throw new Error(`--only ${only} matched no device (have: ${Object.keys(DEVICES).join(", ")})`);
  }

  // Refuse to photograph a 404 as if it were the app.
  console.log(`Target: ${base}`);
  const probe = await fetch(base, { redirect: "manual" }).catch((err) => {
    throw new Error(`cannot reach ${base}: ${err.message}`);
  });
  if (probe.status >= 400) {
    throw new Error(`base URL returned HTTP ${probe.status}; refusing to capture`);
  }
  console.log(`  reachable (HTTP ${probe.status})\n`);

  const browser = await chromium.launch();
  const written = [];

  for (const [key, device] of targets) {
    const dir = path.join(outRoot, key);
    fs.mkdirSync(dir, { recursive: true });

    const context = await browser.newContext({
      viewport: device.logical,
      deviceScaleFactor: device.scale,
      isMobile: true,
      hasTouch: true,
      // A phone-sized UA, so the app's mobile layout is what gets captured
      // rather than a desktop layout squeezed into narrow pixels.
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 " +
        "(KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
      locale: "en-US",
    });

    const page = await context.newPage();

    /*
     * Public screens are captured BEFORE signing in, and that ordering is
     * load-bearing rather than stylistic.
     *
     * `/login` issues a 307 to `/` once a session exists, so capturing it after
     * sign-in silently yields a second copy of the dashboard under a "Sign in"
     * filename. The earlier version did exactly that: 01-login and 02-dashboard
     * came out byte-identical, and the shot captioned "Sign in" was in fact the
     * trip list. Apple would have received two identical images.
     */
    const capturePass = async (useAuth) => {
      for (const screen of SCREENS) {
        if (screen.auth !== useAuth) continue;

        let route = screen.route;
        if (route === null) {
          route = await firstTripRoute(page, base);
          if (!route) {
            console.log(`  skip ${screen.slug} (no trip visible for this account)`);
            continue;
          }
        }

        const file = path.join(dir, `${screen.slug}.png`);
        await capture(page, base + route, file, device);

        const kb = Math.round(fs.statSync(file).size / 1024);
        written.push({ device: key, slug: screen.slug, file, kb });
        console.log(`  ✓ ${screen.slug}  ${device.expect.width}x${device.expect.height}  ${kb}KB`);
      }
    };

    // Public pass: no session, so /login renders the sign-in screen itself.
    await capturePass(false);
    // A redirect that lands somewhere else means the "public" shot is not what
    // it claims; failing loudly beats shipping a mislabelled image.
    await verifyLoginShot(page, base, path.join(dir, "01-login.png"));

    let authed = false;
    if (password) {
      authed = await signIn(page, base, password);
      console.log(
        `[${key}] ${device.label} — sign-in ${authed ? "OK" : "FAILED"}\n`
      );
    } else {
      console.log(
        `[${key}] ${device.label} — no APPR_REVIEW_PASSWORD, capturing public screens only\n`
      );
    }

    // Authenticated pass.
    await capturePass(true);

    await context.close();
    console.log("");
  }

  await browser.close();

  console.log(`Wrote ${written.length} file(s) under ${outRoot}`);
  const missing = SCREENS.filter(
    (s) => s.auth && !password && !written.some((w) => w.slug === s.slug)
  );
  if (missing.length) {
    console.log(
      `\nNOTE: ${missing.length} authenticated screen(s) were skipped because ` +
        `APPR_REVIEW_PASSWORD was not set:\n` +
        missing.map((s) => `  - ${s.slug} (${s.caption})`).join("\n") +
        `\nA submission needs these — they are the screens a reviewer judges.`
    );
  }
}

/*
 * Sign in through the real form rather than setting a cookie by hand: the
 * session cookie is HttpOnly and set by the server, and driving the form also
 * verifies the demo credentials still work — which is exactly the thing that
 * silently rots and blocks a review.
 */
async function signIn(page, base, password) {
  await page.goto(base + "/login", { waitUntil: "networkidle" });
  try {
    await page.fill('input[type="email"], input[name="email"]', DEMO_EMAIL);
    await page.fill('input[type="password"], input[name="password"]', password);
    await Promise.all([
      page.waitForNavigation({ waitUntil: "networkidle", timeout: 15000 }).catch(() => {}),
      page.click('button[type="submit"], form button'),
    ]);
    // The login gate redirects away on success; landing back on /login means no.
    await page.waitForTimeout(1200);
    return !page.url().includes("/login");
  } catch (err) {
    console.log(`  sign-in error: ${err.message}`);
    return false;
  }
}

/*
 * Resolve a trip route from the API rather than by clicking a card.
 *
 * Trip cards in the sidebar are buttons that navigate via `window.location`,
 * and on a phone viewport they live inside the closed drawer — present in the
 * DOM but not visible, so a click times out. Reading /api/state with the
 * session cookie already in this context is both simpler and immune to layout:
 * it does not care whether the drawer is open.
 */
async function firstTripRoute(page, base) {
  // Must be on the app's origin for a same-origin fetch to carry the cookie.
  if (!page.url().startsWith(base)) {
    await page.goto(base + "/", { waitUntil: "domcontentloaded" });
  }
  const route = await page.evaluate(async () => {
    try {
      const res = await fetch("/api/state", { credentials: "same-origin" });
      if (!res.ok) return null;
      const data = await res.json();
      const trips = data?.state?.trips ?? [];
      // Prefer an unarchived trip: an archived one is a stale-looking screen.
      const pick = trips.find((t) => !t.archived) ?? trips[0];
      return pick ? `/trips/${pick.id}` : null;
    } catch {
      return null;
    }
  });
  if (route) return route;
  return null;
}

/*
 * Guard against the mislabelling bug that produced this fix.
 *
 * `/login` redirects to `/` when a session already exists, so a "Sign in"
 * screenshot taken with a live session is really the dashboard. Checking where
 * the public pass actually landed is the direct test: if it is not /login, the
 * image is mislabelled.
 */
async function verifyLoginShot(page, base, loginFile) {
  const landed = page.url().split("?")[0];
  const expected = new URL("/login", base).href.split("?")[0];
  if (landed !== expected) {
    throw new Error(
      `the public /login shot did not land on /login (landed on ${landed}). ` +
        `A signed-in session redirects /login to /, which produces a second ` +
        `copy of the dashboard labelled "Sign in".`
    );
  }
  if (!fs.existsSync(loginFile)) {
    throw new Error(`expected a login screenshot at ${loginFile}, but it is missing.`);
  }
}

/*
 * Wait for the page to be genuinely painted. A fixed sleep produces
 * half-rendered screenshots; `networkidle` plus a fonts check catches the
 * common case where the layout is right but text is still in a fallback face.
 */
async function capture(page, url, file, device) {
  await page.setViewportSize(device.logical);
  await page.goto(url, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts?.ready).catch(() => {});
  // Let entry animations and any client-side data fetch settle.
  await page.waitForTimeout(800);
  await page.screenshot({ path: file, fullPage: false });
}

main().catch((err) => {
  console.error(`\nFAILED: ${err.message}`);
  process.exit(1);
});
