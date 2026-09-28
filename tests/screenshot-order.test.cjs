/**
 * The screenshot script must capture /login BEFORE it signs in.
 *
 * This is not style. `/login` issues a 307 to `/` once a session cookie exists
 * (see src/app/login/page.tsx). So a "Sign in" capture taken after sign-in does
 * not fail -- it silently produces a second, identical copy of the dashboard
 * under the login screen's filename. The first run of this script did exactly
 * that: the login shot and the dashboard shot were byte-identical, and the image
 * captioned "Sign in" was the trip list. Apple would have received two
 * identical images.
 *
 * The bug is invisible in the console (it prints "sign-in OK" and a tick for
 * every file) and invisible in the file sizes (both were 147KB), which is why
 * it needs a test rather than a careful reading.
 *
 * The same "identical output, no error" failure mode bit a second time when the
 * trip page's tabs were captured: those tabs are React state rather than URL
 * state, so four `?tab=` URLs produced four byte-identical map screenshots. The
 * lesson generalises -- for this script, HASH THE OUTPUT; filenames, sizes and
 * console ticks all lie.
 */
const fs = require("node:fs");
const path = require("node:path");
const h = require("./harness.cjs");

const SRC = fs.readFileSync(
  path.join(__dirname, "..", "scripts", "make-screenshots.cjs"),
  "utf8"
);

(async () => {
  await h.test("public screens are captured before sign-in", () => {
    const publicPass = SRC.indexOf("await capturePass(false)");
    const signIn = SRC.indexOf("await signIn(page, base, password)");
    const authPass = SRC.indexOf("await capturePass(true)");

    h.assert(publicPass !== -1, "expected a capturePass(false) call for public screens");
    h.assert(signIn !== -1, "expected a signIn(...) call");
    h.assert(authPass !== -1, "expected a capturePass(true) call for authed screens");

    h.assert(
      publicPass < signIn,
      "the public pass must run BEFORE signIn(), or /login 307s to / and the " +
        "sign-in screenshot becomes a duplicate of the dashboard"
    );
    h.assert(
      signIn < authPass,
      "the authenticated pass must run AFTER signIn()"
    );
  });

  await h.test("the login shot is verified, not assumed", () => {
    h.assert(
      /verifyLoginShot\s*\(/.test(SRC),
      "expected a verifyLoginShot(...) call guarding the public pass"
    );
    h.assert(
      /async function verifyLoginShot/.test(SRC),
      "expected verifyLoginShot to be defined"
    );
    // It must actually check where the page landed.
    const fn = SRC.slice(SRC.indexOf("async function verifyLoginShot"));
    h.assert(
      /page\.url\(\)/.test(fn),
      "verifyLoginShot must inspect page.url() to detect a redirect away from /login"
    );
  });

  /*
   * Asserts the auth flag on each screen by SLUG, not by position.
   *
   * The earlier version sliced the table using the neighbouring slugs as
   * delimiters (`slice(indexOf("01-login"), indexOf("02-dashboard"))`). That
   * broke the moment the screens were reordered and renamed for the App Store
   * listing: both indexOf() calls returned -1 and the test failed for a reason
   * that had nothing to do with what it was checking. Parsing each entry out of
   * the table survives reordering, which is the point -- the order is a
   * presentation decision and is expected to change.
   */
  await h.test("each screen declares the right auth requirement", () => {
    const block = SRC.slice(SRC.indexOf("const SCREENS"), SRC.indexOf("];", SRC.indexOf("const SCREENS")));

    // Each entry looks like { slug: "...", ... auth: <bool>, ... }.
    const entries = [...block.matchAll(/slug:\s*"([^"]+)"([\s\S]*?)(?=\n  \{|$)/g)];
    h.assert(entries.length >= 4, `expected several screens, parsed ${entries.length}`);

    const authOf = (slug) => {
      const e = entries.find(([, s]) => s === slug);
      h.assert(e, `no SCREENS entry with slug "${slug}"`);
      const m = e[2].match(/auth:\s*(true|false)/);
      h.assert(m, `slug "${slug}" has no auth flag`);
      return m[1];
    };

    /*
     * The login screen MUST be public. If it is ever marked auth: true it gets
     * captured after sign-in, where `/login` 307s to `/` -- producing a second
     * copy of the dashboard under the sign-in filename.
     */
    h.assert(
      authOf("04-login") === "false",
      "04-login must be auth: false so it is captured without a session"
    );

    // Authenticated screens must require a session, or they capture a redirect
    // to /login instead of the screen they claim to be.
    for (const slug of ["03-dashboard", "05-profile"]) {
      h.assert(
        authOf(slug) === "true",
        `${slug} must be auth: true so it is captured with a session`
      );
    }
  });

  h.summary();
})();
