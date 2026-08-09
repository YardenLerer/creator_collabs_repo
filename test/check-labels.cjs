/* Fails if any controlled value could ever reach a screen as raw snake_case. */
const src = require("fs").readFileSync(require("path").join(__dirname, "../src/App.jsx"), "utf8");
const block = src.slice(src.indexOf("const LABEL_OVERRIDE = {"), src.indexOf("const label = (v) ="));
const keys = new Set([...block.matchAll(/(?:^|[\s{,])("?)([A-Za-z0-9_]+)\1\s*:\s*"/g)].map(m => m[2]));
const values = new Set();
for (const m of src.matchAll(/^const ([A-Z_0-9]+) = \[([^\]]*)\];/gm)) {
  if (["STAGES", "BRANCHES", "SEARCH_FIELDS"].includes(m[1])) continue;
  for (const v of m[2].matchAll(/"([a-z0-9_]+)"/g)) values.add(v[1]);
}
const missing = [...values].filter(v => !keys.has(v)).sort();
console.log(`${values.size} controlled values · ${keys.size} labels · ${missing.length} missing`);
if (missing.length) { console.log("MISSING:", missing.join(", ")); process.exit(1); }
console.log("every controlled value has a human name");
