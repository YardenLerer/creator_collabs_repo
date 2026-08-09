/* One gate.
 *
 * If this passes the build is deployable; if any line fails it is not, and the
 * reason is on screen rather than in somebody's memory.
 *
 * It was a bash script with absolute sandbox paths, which meant the fifteen
 * checks the README promised could not run for anyone who cloned the repo. It
 * is Node now, resolves everything relative to itself, and runs on Windows.
 */
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";

const here = dirname(fileURLToPath(import.meta.url));

const CHECKS = [
  ["validation rules", "validation.test.cjs"],
  ["the model word matcher", "ai.test.mjs"],
  ["score row shaping", "score.test.mjs"],
  ["connection handling", "config.test.mjs"],
  ["database failure handling", "db.test.mjs"],
  ["the write diff", "sync.test.mjs"],
  ["stage gates", "states.test.mjs"],
  ["human names everywhere", "check-labels.cjs"],
  ["nothing raw reaches a screen", "rawscan.cjs"],
  ["every screen renders", "screens.cjs"],
  ["the app boots and runs", "mount.mjs"],
  ["a first load seeds", "empty.mjs"],
  ["a stranger sees the product", "anon.mjs"],
  ["intake opens on click", "intake.mjs"],
  ["library opens on click", "libclick.mjs"],
  ["library row shapes", "lib.cjs"],
  ["frames survive a write", "thumbs.cjs"],
  ["accepting is one write", "library.cjs"],
  ["the new features render", "feat.cjs"],
  ["every AI has a way in", "ai-reachable.cjs"],
  ["no old style layer", "bodycheck.mjs"],
];

let failed = 0;
let skipped = 0;

for (const [name, file] of CHECKS) {
  const path = join(here, file);
  if (!existsSync(path)) {
    // A check that is not there is reported, never silently counted as a pass.
    console.log(`${name.padEnd(34)}MISSING (${file})`);
    skipped++;
    continue;
  }
  const r = spawnSync(process.execPath, [path], { cwd: here, encoding: "utf8" });
  if (r.status === 0) {
    console.log(`${name.padEnd(34)}ok`);
  } else {
    failed++;
    console.log(`${name.padEnd(34)}FAIL`);
    const out = `${r.stdout ?? ""}${r.stderr ?? ""}`.trim().split("\n").slice(-5);
    for (const line of out) console.log(`      ${line}`);
  }
}

console.log();
if (failed === 0 && skipped === 0) console.log("everything passes");
else if (failed === 0) console.log(`${skipped} check(s) missing - do not deploy`);
else console.log(`${failed} check(s) failing - do not deploy`);

process.exit(failed || skipped ? 1 : 0);
