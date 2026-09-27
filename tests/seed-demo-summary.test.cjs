/*
 * Tests that the review-account seeder REPORTS its bag count.
 *
 * Why this is worth a test rather than trusting the code: bags are the visible
 * 1.0 feature App Review opens first, and an empty Bags section is called out in
 * the submission docs as a guideline 4.2 rejection risk. `deploy/update.sh`
 * re-seeds this account on every deploy and greps the seeder's stdout for a
 * summary.
 *
 * The gap this closes: the summary reported trips, items, reservations and login
 * -- but NOT bags. So the deploy log could not answer the one question it most
 * needed to ("did the bags seed?"), and a regression that dropped them would
 * have printed a clean-looking summary either way. A verification output that
 * omits the field under repair verifies nothing.
 *
 * These assertions are about the SHAPE of the reported summary, so they are
 * source-level: there is no way to run the seeder's `console.log` lines without
 * a database, and the property worth pinning is that the line exists at all.
 */

const fs = require("fs");
const path = require("path");
const h = require("./harness.cjs");

const SEED = fs.readFileSync(
  path.join(__dirname, "..", "scripts", "seed-demo.cjs"),
  "utf8"
);
const DEPLOY = fs.readFileSync(
  path.join(__dirname, "..", "deploy", "update.sh"),
  "utf8"
);

async function run() {
  await h.test("the seeder counts bags per trip", () => {
    // Without the count on the return value there is nothing to report.
    h.assert(
      /return\s*\{[^}]*bagCount/.test(SEED),
      "insertTrip must return a bagCount so main() can report it"
    );
  });

  await h.test("the seeder prints a bags line in its summary", () => {
    h.assert(
      /console\.log\(\s*`\s*bags\s+\$\{bagTotal\}/.test(SEED),
      "the summary must print a 'bags' line"
    );
    h.assert(
      /bagTotal\s*=\s*\w+\.bagCount\s*\+\s*\w+\.bagCount/.test(SEED),
      "the reported total must sum both trips, not just the active one"
    );
  });

  await h.test("zero bags is reported as a PROBLEM, not as a neutral count", () => {
    /*
     * The load-bearing assertion. A summary that prints "bags 0" in the same
     * tone as "bags 2" relies on the reader knowing that zero is fatal -- and
     * on a deploy log nobody reads line by line. Mark it.
     */
    h.assert(
      /bagTotal\s*===\s*0[\s\S]{0,120}?PROBLEM/.test(SEED),
      "an empty Bags section must be flagged, since it is a 4.2 rejection risk"
    );
  });

  await h.test("update.sh does not grep the bags line away", () => {
    /*
     * The subtle half. update.sh filters the seeder's output with
     * `grep -E "trips|items|login|owner"`, so a new summary line is invisible
     * unless the filter is updated too. Fixing the seeder alone would have
     * produced correct output that the deploy never shows -- a fix that looks
     * complete in review and does nothing in production.
     */
    h.assert(
      /grep\s+-E\s+"[^"]*\bbags\b[^"]*"\s+\/tmp\/seed-demo\.log/.test(DEPLOY),
      "update.sh must include 'bags' in its summary grep, or it hides the line"
    );
  });

  await h.summary();
}

run();
