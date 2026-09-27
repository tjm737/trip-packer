/**
 * The screenshot script must capture /login BEFORE it signs in.
 *
 * This is not style. `/login` issues a 307 to `/` once a session cookie exists
 * (see src/app/login/page.tsx). So a "Sign in" capture taken after sign-in does
 * not fail -- it silently produces a second, identical copy of the dashboard
 * under the filename 01-login.png. The first run of this script did exactly
 * that: 01-login and 02-dashboard were byte-identical, and the image captioned
 * "Sign in" was the trip list. Apple would have received two identical images.
 *
 * The bug is invisible in the console (it prints "sign-in OK" and a tick for
 * every file) and invisible in the file sizes (both were 147KB), which is why
 * it needs a test rather than a careful reading.
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

  await h.test("the login screen is marked public in the screen table", () => {
    const block = SRC.slice(SRC.indexOf("const SCREENS"), SRC.indexOf("];", SRC.indexOf("const SCREENS")));
    const login = block.slice(block.indexOf('"01-login"'), block.indexOf('"02-dashboard"'));
    h.assert(
      /auth:\s*false/.test(login),
      "01-login must be auth: false so it is captured without a session"
    );
    const dash = block.slice(block.indexOf('"02-dashboard"'), block.indexOf('"03-trip-packing"'));
    h.assert(
      /auth:\s*true/.test(dash),
      "02-dashboard must be auth: true so it is captured with a session"
    );
  });

  h.summary();
})();
