#!/usr/bin/env node
/*
 * Guards the privacy manifest against the defect that cost two App Store
 * rejections (ITMS-91056).
 *
 * The bug was NOT the key names or the value types. It was the COMMENTS. A
 * double hyphen is illegal anywhere inside an XML comment, and the manifest
 * used several as prose dashes. Apple's strict XML parser rejects the entire
 * manifest when it meets one:
 *
 *   ITMS-91056: Invalid privacy manifest - The PrivacyInfo.xcprivacy file
 *   from the following path is invalid: "PrivacyInfo.xcprivacy".
 *
 * Worth a test rather than a code-review habit: `plutil -lint` reports OK on
 * those files, because plutil is lenient about comment bodies. The check a
 * developer would naturally reach for says the file is fine while Apple
 * rejects it. The only local gate that catches it is a strict XML parse.
 *
 * Same shape as the screenshot tests: a check that passes while the thing it
 * appears to be checking is broken.
 */
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const h = require("./harness.cjs");

const MANIFEST = path.join(
  __dirname,
  "..",
  "ios",
  "App",
  "App",
  "PrivacyInfo.xcprivacy"
);

const SRC = fs.readFileSync(MANIFEST, "utf8");

/*
 * Mask the legal delimiters (<!-- and -->) so what remains is only comment
 * BODIES plus regular content. Any surviving '--' is illegal.
 */
function findIllegalDoubleHyphens(text) {
  const hits = [];
  text.split("\n").forEach((line, i) => {
    const masked = line.replace(/<!--/g, "\u0001").replace(/-->/g, "\u0002");
    if (masked.includes("--")) hits.push(`  line ${i + 1}: ${line.trim()}`);
  });
  return hits;
}

(async () => {
  // The actual root cause. If this ever fires, the manifest will be rejected.
  await h.test("privacy manifest has no illegal '--' inside an XML comment", () => {
    const hits = findIllegalDoubleHyphens(SRC);
    h.assert(
      hits.length === 0,
      "A double hyphen is illegal inside an XML comment and makes Apple " +
        "reject the manifest with ITMS-91056. Use an em dash instead:\n" +
        hits.join("\n")
    );
  });

  /*
   * The real gate, mirroring Apple's parser rather than plutil's lenient one.
   * Python is used because its XML parser is strict by default in exactly the
   * way that matters here, and it is present on any machine that can build
   * this app.
   */
  await h.test("privacy manifest is well-formed XML under a strict parser", () => {
    let ok = true;
    let detail = "";
    try {
      execFileSync(
        "python3",
        [
          "-c",
          "import sys, xml.etree.ElementTree as ET; ET.parse(sys.argv[1])",
          MANIFEST,
        ],
        { stdio: ["ignore", "ignore", "pipe"] }
      );
    } catch (err) {
      ok = false;
      detail = (err.stderr || Buffer.from("")).toString().trim();
    }
    h.assert(ok, `strict XML parse failed: ${detail}`);
  });

  /*
   * All three tracking-related keys are Booleans per Apple's documentation.
   * An earlier revision had the inner two as strings, which was wrong and is
   * what build 2 shipped. Guarded so it cannot drift back.
   */
  await h.test("privacy manifest declares tracking keys as booleans", () => {
    const strings = SRC.match(/<string>(?:true|false)<\/string>/g) || [];
    h.assert(
      strings.length === 0,
      "Found quoted booleans: " +
        strings.join(", ") +
        ". Apple documents NSPrivacyTracking, NSPrivacyCollectedDataTypeLinked " +
        "and NSPrivacyCollectedDataTypeTracking as Booleans; write <true/>."
    );
    h.assert(
      /<key>NSPrivacyTracking<\/key>\s*<false\/>/.test(SRC),
      "NSPrivacyTracking should be present and <false/>"
    );
  });

  /*
   * Enumerated values must be spelled exactly. Verified against Apple's App
   * Privacy Configuration reference, which lists 35 valid values for
   * NSPrivacyCollectedDataType and 6 for the purpose key.
   */
  await h.test("privacy manifest uses valid collected data types", () => {
    const VALID = [
      "NSPrivacyCollectedDataTypeEmailAddress",
      "NSPrivacyCollectedDataTypeName",
      "NSPrivacyCollectedDataTypeOtherUserContent",
    ];
    const declared =
      SRC.match(
        /<key>NSPrivacyCollectedDataType<\/key>\s*<string>([^<]+)<\/string>/g
      ) || [];
    h.assert(
      declared.length === 3,
      `expected 3 collected data types, found ${declared.length}`
    );
    declared.forEach((block) => {
      const value = block.match(/<string>([^<]+)<\/string>/)[1];
      h.assert(VALID.includes(value), `unknown collected data type: ${value}`);
    });
  });

  await h.test("privacy manifest uses the app-functionality purpose only", () => {
    const purposes =
      SRC.match(/<string>NSPrivacyCollectedDataTypePurpose[^<]*<\/string>/g) || [];
    h.assert(
      purposes.length === 3,
      `expected 3 purpose entries, found ${purposes.length}`
    );
    purposes.forEach((p) => {
      const value = p.replace(/<\/?string>/g, "");
      h.assert(
        value === "NSPrivacyCollectedDataTypePurposeAppFunctionality",
        `unexpected purpose value: ${value}`
      );
    });
  });

  h.summary();
})();
