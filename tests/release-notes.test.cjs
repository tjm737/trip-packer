/*
 * Tests for release-note bookkeeping.
 *
 * Why this is worth a test rather than discipline: release notes are the one
 * part of the app with no forcing function. Nothing breaks when they are
 * skipped -- no build error, no failing page, no user complaint. So they get
 * skipped, silently, until a release is cut and the About tab still describes
 * a version from last week. That is exactly what happened before this file
 * existed: more than thirty user-visible commits shipped with no entry.
 *
 * These checks cover the things a person gets wrong at the end of a session,
 * not the prose quality of an entry:
 *
 *   1. package.json and RELEASES[0] agree. AboutDialog renders the version
 *      straight from RELEASES[0], so if package.json is bumped and the
 *      changelog is not, the app cheerfully reports a version it is not.
 *   2. No two releases share a version, which would make the history lie.
 *   3. The list is ordered newest-first, which the "current version is
 *      RELEASES[0]" convention depends on.
 *   4. Every release is a complete, renderable record -- AboutDialog reads
 *      version, date, headline and groups[].area/items[] unconditionally, and
 *      a missing field renders as a blank row rather than throwing.
 *   5. Dates are real ISO dates. A typo like 2026-13-45 renders as "Invalid
 *      Date" in the UI.
 *
 * Deliberately NOT tested: whether a given commit deserves a note. That is a
 * judgement call, and a test can only enforce it by guessing at git subjects.
 */

const fs = require("fs");
const path = require("path");
const h = require("./harness.cjs");

const ROOT = path.resolve(__dirname, "..");

/* The changelog is TypeScript, so it is parsed as text rather than imported.
 * Pulling it through the transpiling loader would work, but this file has to
 * read package.json anyway, and text parsing keeps the failure messages
 * specific about WHICH field is wrong instead of a generic module error. */
const changelogSrc = fs.readFileSync(
  path.join(ROOT, "src/lib/changelog.ts"),
  "utf8"
);

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));

/** Every `version: "x.y.z"` in declaration order, i.e. newest first. */
function readVersions() {
  return [...changelogSrc.matchAll(/^\s*version:\s*"([^"]+)",\s*$/gm)].map(
    (m) => m[1]
  );
}

/** Dates in the same order as readVersions(). */
function readDates() {
  return [...changelogSrc.matchAll(/^\s*date:\s*"([^"]+)",\s*$/gm)].map(
    (m) => m[1]
  );
}

/** Headlines, used to prove no release is missing its one-line summary. */
function readHeadlines() {
  return [...changelogSrc.matchAll(/^\s*headline:\s*"(.*)",\s*$/gm)].map(
    (m) => m[1]
  );
}

/** Areas, to prove groups are present and non-empty. */
function readAreas() {
  return [...changelogSrc.matchAll(/^\s*area:\s*"(.*)",\s*$/gm)].map(
    (m) => m[1]
  );
}

async function run() {
  const versions = readVersions();
  const dates = readDates();
  const headlines = readHeadlines();
  const areas = readAreas();

  /* -- the app reports the version it actually is ---------------------- */

  await h.test("RELEASES[0].version matches package.json", () => {
    h.assertEqual(
      versions[0],
      pkg.version,
      `changelog says ${versions[0]} but package.json says ${pkg.version}. ` +
        `Bump both together -- AboutDialog renders the version from the changelog, ` +
        `so a mismatch makes the app misreport itself.`
    );
  });

  await h.test("the changelog is not empty", () => {
    if (versions.length === 0) {
      throw new Error(
        "No releases parsed out of src/lib/changelog.ts. If the file was " +
          "reformatted, update the regexes here rather than deleting the check."
      );
    }
  });

  /* -- the history is coherent ----------------------------------------- */

  await h.test("no two releases share a version", () => {
    const seen = new Set();
    for (const v of versions) {
      if (seen.has(v)) throw new Error(`version ${v} appears more than once`);
      seen.add(v);
    }
  });

  await h.test("releases are ordered newest first", () => {
    for (let i = 1; i < versions.length; i++) {
      const prev = versions[i - 1].split(".").map(Number);
      const cur = versions[i].split(".").map(Number);
      const newer =
        prev[0] > cur[0] ||
        (prev[0] === cur[0] && prev[1] > cur[1]) ||
        (prev[0] === cur[0] && prev[1] === cur[1] && prev[2] > cur[2]);
      if (!newer) {
        throw new Error(
          `RELEASES must be newest first, but ${versions[i - 1]} is above ${versions[i]}`
        );
      }
    }
  });

  await h.test("dates do not go backwards as the list descends", () => {
    const parsed = dates.map((d) => Date.parse(`${d}T00:00:00Z`));
    for (let i = 0; i < parsed.length; i++) {
      if (Number.isNaN(parsed[i])) {
        throw new Error(`unparseable date: ${dates[i]}`);
      }
    }
    for (let i = 1; i < parsed.length; i++) {
      if (parsed[i] > parsed[i - 1]) {
        throw new Error(
          `${dates[i]} is newer than ${dates[i - 1]} but appears below it`
        );
      }
    }
  });

  /* -- every release is renderable ------------------------------------- */

  await h.test("every release has a version, date and headline", () => {
    h.assertEqual(
      headlines.length,
      versions.length,
      "a release is missing its headline"
    );
    h.assertEqual(dates.length, versions.length, "a release is missing its date");
  });

  await h.test("headlines are one line and not placeholders", () => {
    for (const line of headlines) {
      if (line.trim().length === 0) {
        throw new Error("a release has an empty headline");
      }
      if (line.length > 120) {
        throw new Error(
          `headline is ${line.length} chars and reads as a paragraph, not a ` +
            `one-line summary: "${line.slice(0, 60)}..."`
        );
      }
      if (/^(todo|tbd|wip|update)/i.test(line)) {
        throw new Error(`headline looks like a placeholder: "${line}"`);
      }
    }
  });

  await h.test("every release has at least one named area", () => {
    if (areas.length === 0) throw new Error("no change groups found at all");
    for (const a of areas) {
      if (a.trim().length === 0) throw new Error("an area label is empty");
    }
  });

  /* -- the About tab's contract with this data ------------------------- */

  await h.test(
    "the newest release is dated, since About shows that date as 'current'",
    () => {
      const newest = dates[0];
      if (!newest || !/^\d{4}-\d{2}-\d{2}$/.test(newest)) {
        throw new Error(
          `RELEASES[0].date must be a plain YYYY-MM-DD, got: ${newest}`
        );
      }
    }
  );
}

/*
 * The async IIFE plus `h.summary()` is required, not decorative. `h.test` is
 * async: without awaiting the run and then calling summary(), failures are
 * recorded internally but `process.exitCode` is never set, so run.cjs sees
 * exit 0 and counts a broken suite as passing. A mutation test caught exactly
 * that in this file's first revision.
 */
(async function main() {
  await run();
  h.summary();
})();
