/* The score object the screens carry is wider than the table. This is the bug
   that produced "The database rejected the data" with nothing actionable. */
import { readFileSync } from "fs";
const src = readFileSync(new URL("../src/lib/repos.js", import.meta.url), "utf8");
const cols = JSON.parse("[" + src.split("const SCORE_COLUMNS = [")[1].split("];")[0]
  .replace(/\n/g, " ").replace(/,\s*$/, "") + "]");

const scoreRow = (s) => {
  const row = {};
  for (const k of cols) if (s[k] !== undefined) row[k] = s[k];
  row.ai_status ??= "not_run"; row.disqualified ??= []; row.measured ??= {};
  row.taxonomy_version ??= 1;
  return row;
};

let pass = 0, bad = 0;
const is = (n, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? (pass++, console.log("  ok   " + n))
     : (bad++, console.log(`  FAIL ${n}\n       got  ${JSON.stringify(got)}\n       want ${JSON.stringify(want)}`));
};

const wide = { creator_id: "c1", gap_id: "g1", measured: { branch_fit: 100 },
  ai_status: "failed_shape", ai_error_detail: "affinity missing", basis: ["sauna"],
  rationale: "x", concern: null, somethingNew: 1 };

const row = scoreRow(wide);
is("unknown fields are dropped", Object.keys(row).sort(),
   ["ai_status", "creator_id", "disqualified", "gap_id", "measured", "taxonomy_version"]);
is("a working field never reaches the table", row.ai_error_detail, undefined);
is("required columns are filled", [row.ai_status, row.disqualified, row.taxonomy_version],
   ["failed_shape", [], 1]);
is("a bare score still writes", scoreRow({ creator_id: "c", gap_id: "g" }).ai_status, "not_run");

console.log(`\n  ${pass} passed, ${bad} failed`);
process.exit(bad ? 1 : 0);
