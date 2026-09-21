/*
 * Test entrypoint. Runs every tests/*.test.cjs in its own process so a failure
 * or module-load error in one suite cannot take down the others.
 */

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const dir = __dirname;
const files = fs
  .readdirSync(dir)
  .filter((f) => f.endsWith(".test.cjs"))
  .sort();

let failed = 0;
for (const f of files) {
  const res = spawnSync(process.execPath, [path.join(dir, f)], { stdio: "inherit" });
  if (res.status !== 0) failed++;
}

console.log("");
console.log(`Ran ${files.length} test file(s); ${failed} failing.`);
process.exit(failed > 0 ? 1 : 0);
