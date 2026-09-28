#!/usr/bin/env node
/*
 * Guards the create-* flows' success signals in AppContext.
 *
 * The bug this pins: each `create()` derived the new record's id from the LAST
 * element of a server-returned array (`result.trips.at(-1)`, `.categories.at(-1)`,
 * `.bags.at(-1)`). That only works because /api/state happens to ORDER BY
 * createdAt ascending, so the newest record sorts last. It is an artifact of the
 * query, not a property of an insert -- a reordering, or two records created in
 * the same millisecond, silently yields the WRONG id.
 *
 * Concretely, for trips this produced the reported "I completed the create flow
 * and the trip didn't appear": create() returned "" (or another trip's id) on
 * the path where the write was only queued offline, and the dashboard closed the
 * dialog and navigated nowhere.
 *
 * Assertions run against comment-stripped source. Matching raw text would pass
 * on the explanatory comments alone -- the very comments that document the fix
 * contain the string `result.trips.at(-1)`.
 */
const fs = require("fs");
const h = require("./harness.cjs");

const APP_CONTEXT = h.SRC + "/lib/appContext.tsx";
const DASHBOARD = h.SRC + "/app/(app)/DashboardClient.tsx";
const STORAGE = h.SRC + "/lib/storage.ts";

/** Removes // and /* *\/ comments so assertions test behaviour, not prose. */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

/** Returns the brace-balanced body of a `const <name> = ... => {` function. */
function functionBody(src, header) {
  const start = src.indexOf(header);
  if (start === -1) return null;
  let depth = 0, began = false;
  for (let i = start; i < src.length; i++) {
    if (src[i] === "{") { depth++; began = true; }
    else if (src[i] === "}") {
      depth--;
      if (began && depth === 0) return src.slice(start, i + 1);
    }
  }
  return null;
}

(async () => {
  const rawApp = fs.readFileSync(APP_CONTEXT, "utf8");
  const app = stripComments(rawApp);
  const dash = stripComments(fs.readFileSync(DASHBOARD, "utf8"));
  const storage = stripComments(fs.readFileSync(STORAGE, "utf8"));

  await h.test("no create() infers a new record's id from array position", () => {
    /*
     * Blanket assertion across all three create actions. `.at(-1)` on a state
     * array is the smell in every case: it asserts the new record is last.
     */
    const offenders = (app.match(/result\.\w+\??\.at\(-1\)/g) || []);
    h.assert(
      offenders.length === 0,
      "create() actions must not read the created id from array position; " +
        "found: " + offenders.join(", ")
    );
    const tripCreate = functionBody(app, "create: async (");
    h.assert(tripCreate !== null, "could not locate trip create()");
    h.assert(
      /created\.trip\.id/.test(tripCreate),
      "trip create() must take the id from createTrip()'s returned trip"
    );
  });

  await h.test("every create() reports no id when the write was only queued", () => {
    /*
     * `run` returns null for a queued-for-later (offline) write. In that case
     * the record does not exist yet, so returning its id would navigate to a
     * 404. All three must collapse that to "".
     */
    const returns = app.match(/return result \? [a-zA-Z]+ : ""/g) || [];
    h.assert(
      returns.length >= 3,
      "expected trip/category/bag create() to each return \"\" when run() " +
        "yielded no authoritative state; found " + returns.length
    );
  });

  await h.test("handleCreate does not close the dialog without an id", () => {
    /*
     * The user-visible half. The regression was an UNGUARDED close:
     *   if (createdId) router.push(...);
     *   reset(); onOpenChange(false);
     * so assert the close is on the success path, guarded by a return.
     */
    const body = functionBody(dash, "const handleCreate = async () => {");
    h.assert(body !== null, "could not locate handleCreate");

    const guard = body.indexOf("if (createdId) {");
    h.assert(guard !== -1, "handleCreate must branch on createdId");

    /*
     * The close must be INSIDE the `if (createdId)` block, not after it. Compare
     * positions of the guard's closing boundary against the close call: if the
     * close falls after the block, it runs on the failure path too -- which is
     * exactly the original silent-dismiss bug.
     */
    const block = functionBody(body.slice(guard), "if (createdId) {");
    h.assert(block !== null, "could not isolate the if (createdId) block");
    h.assert(
      /onOpenChange\(false\)/.test(block),
      "the success path must close the dialog inside the createdId guard"
    );
    h.assert(
      /return;/.test(block),
      "the success path must return so it cannot fall through to setCreateError"
    );

    /*
     * And the failure path must be outside that block, so it is unreachable when
     * an id came back.
     */
    const afterBlock = body.slice(guard + block.length);
    h.assert(
      /setCreateError\(/.test(afterBlock),
      "setCreateError must sit after the createdId block so success never " +
        "reaches it"
    );
    h.assert(
      /setCreateError\(/.test(body),
      "handleCreate must surface a message when no id came back"
    );
  });

  await h.test("the failure message is rendered, not merely set", () => {
    h.assert(
      /createError && \(/.test(dash),
      "createError must be conditionally rendered in the dialog"
    );
    h.assert(
      /role="alert"/.test(dash),
      'the create failure should be announced via role="alert"'
    );
  });

  await h.test("a queued create is labelled for the offline banner", () => {
    h.assert(
      /New trip: \$\{trip\.name\}/.test(storage),
      "createTrip should pass a label naming the trip so the offline banner " +
        "identifies what is waiting rather than showing a bare count"
    );
  });

  h.summary();
})();
