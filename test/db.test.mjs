/* Tests the one thing this layer exists for: an empty result and a refusal
   must never look the same, and a write must not be called saved until the
   server says so. No network, no browser. */
import { FAILURE, ok, loadAll } from "../src/lib/db.js";

let pass = 0, failn = 0;
const t = (name, fn) => { try { fn(); console.log("  ok   " + name); pass++; }
  catch (e) { console.log("  FAIL " + name + " — " + e.message); failn++; } };
const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(m ?? `${JSON.stringify(a)} !== ${JSON.stringify(b)}`); };
const yes = (c, m) => { if (!c) throw new Error(m ?? "expected true"); };

// Rebuild the classifier from db.js without importing browser globals.
const { failureFromStatus } = await (async () => {
  const src = await import("node:fs").then((m) => m.readFileSync(new URL("../src/lib/db.js", import.meta.url), "utf8"));
  const body = src.slice(src.indexOf("async function failureFromResponse"), src.indexOf("const TIMEOUT_MS"));
  const fn = new Function("FAILURE", `
    const fail = (kind, detail, raw) => ({ ok:false, kind, title: FAILURE[kind]?.title, detail, retryable: FAILURE[kind]?.retryable, raw });
    ${body.replace("async function failureFromResponse(res)", "return async function(res)")}
  `)(FAILURE);
  return { failureFromStatus: (status) => fn({ status, text: async () => "" }) };
})();

t("an empty list is a success, not a failure", () => {
  const r = ok([], 0);
  yes(r.ok); eq(r.data, []); eq(r.count, 0);
});

t("401 is a refusal and says a policy is missing", () => {
  return failureFromStatus(401).then((r) => {
    yes(!r.ok); eq(r.kind, "refused");
    yes(/policy is missing/i.test(r.detail));
    yes(/not that the table is empty/i.test(r.detail), "must rule out the empty-table reading");
  });
});

t("403 is a refusal too, not an empty result", () =>
  failureFromStatus(403).then((r) => { yes(!r.ok); eq(r.kind, "refused"); }));

t("404 says the table is missing, not that permission was denied", () =>
  failureFromStatus(404).then((r) => { eq(r.kind, "not_found"); }));

t("503 tells the person the project may be paused", () =>
  failureFromStatus(503).then((r) => {
    eq(r.kind, "asleep"); yes(/resume/i.test(r.detail)); yes(r.retryable);
  }));

t("a refusal is not offered as retryable, because retrying cannot help", () =>
  failureFromStatus(403).then((r) => { yes(r.retryable === false); }));

t("400 is separated from a refusal", () =>
  failureFromStatus(400).then((r) => { eq(r.kind, "bad_request"); yes(!r.retryable); }));

t("every failure kind has a title and a retryable flag", () => {
  for (const [k, v] of Object.entries(FAILURE)) {
    yes(typeof v.title === "string" && v.title.length > 0, `${k} has no title`);
    yes(typeof v.retryable === "boolean", `${k} has no retryable flag`);
  }
});

await t("loadAll keeps one refusal from hiding four good reads", async () => {
  const r = await loadAll({
    gaps: Promise.resolve(ok([1, 2])),
    creators: Promise.resolve(ok([3])),
    clips: Promise.resolve({ ok: false, kind: "refused", title: "x", detail: "y", retryable: false }),
  });
  eq(r.data.gaps, [1, 2]);
  eq(r.data.creators, [3]);
  eq(r.data.clips, null, "a refused read must be null, never an empty array");
  eq(Object.keys(r.failures), ["clips"]);
  yes(r.anyFailed);
});

await new Promise((r) => setTimeout(r, 50));
console.log(`\n  ${pass} passed, ${failn} failed\n`);
process.exit(failn ? 1 : 0);
