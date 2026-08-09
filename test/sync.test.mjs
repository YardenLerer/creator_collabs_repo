import { createRequire } from "node:module"; const require = createRequire(import.meta.url);
/* The diff has to be exact. Writing a row that did not change is noise;
   missing one that did is data loss. */
import { diffRows, applyDiff } from "../src/lib/sync.js";
let pass = 0, bad = 0;
const t = (n, f) => { try { f(); console.log("  ok   " + n); pass++; } catch (e) { console.log("  FAIL " + n + " — " + e.message); bad++; } };
const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(m ?? `${JSON.stringify(a)} !== ${JSON.stringify(b)}`); };
const yes = (c, m) => { if (!c) throw new Error(m ?? "expected true"); };

t("an unchanged list writes nothing", () => {
  const rows = [{ id: "a", x: 1 }, { id: "b", x: 2 }];
  const d = diffRows(rows, rows.map((r) => ({ ...r })));
  eq([d.added.length, d.changed.length, d.removed.length], [0, 0, 0]);
});

t("a touched timestamp alone is not an edit", () => {
  const before = [{ id: "a", x: 1, updated_at: "t1" }];
  const after = [{ id: "a", x: 1, updated_at: "t2" }];
  eq(diffRows(before, after).changed.length, 0, "re-rendering must not cause a write");
});

t("a real change is caught", () => {
  const d = diffRows([{ id: "a", x: 1 }], [{ id: "a", x: 2 }]);
  eq(d.changed.length, 1); eq(d.changed[0].x, 2);
});

t("added and removed are separated", () => {
  const d = diffRows([{ id: "a" }, { id: "b" }], [{ id: "b" }, { id: "c" }]);
  eq(d.added.map((r) => r.id), ["c"]); eq(d.removed, ["a"]);
});

t("a nested change is caught, not skipped by a shallow compare", () => {
  const d = diffRows([{ id: "a", ai: { room: "sauna" } }], [{ id: "a", ai: { room: "steam_room" } }]);
  eq(d.changed.length, 1);
});

await t("every failure is collected, not just the first", async () => {
  const refuse = (id) => ({ ok: false, kind: "refused", title: "t", detail: "d", retryable: false });
  const repo = {
    create: async (r) => (r.id === "bad1" ? refuse() : { ok: true, data: r }),
    patch: async (id) => (id === "bad2" ? refuse() : { ok: true, data: { id } }),
    destroy: async () => ({ ok: true, data: null }),
  };
  const r = await applyDiff(repo, {
    added: [{ id: "good" }, { id: "bad1" }], changed: [{ id: "bad2" }], removed: [],
  });
  yes(!r.ok);
  eq(r.failures.length, 2, "both failures must be reported");
  yes(/2 records could not be saved/.test(r.detail));
});

await t("one refused row does not stop the rest from being attempted", async () => {
  const tried = [];
  const repo = {
    create: async (r) => { tried.push(r.id); return r.id === "x" ? { ok: false, kind: "refused", detail: "d", retryable: false } : { ok: true, data: r }; },
    patch: async () => ({ ok: true, data: {} }), destroy: async () => ({ ok: true, data: null }),
  };
  await applyDiff(repo, { added: [{ id: "x" }, { id: "y" }, { id: "z" }], changed: [], removed: [] });
  eq(tried, ["x", "y", "z"], "stopping early leaves the screen unable to say what state things are in");
});

await t("the failure says which operation it happened during", async () => {
  const repo = {
    create: async () => ({ ok: true, data: {} }), patch: async () => ({ ok: true, data: {} }),
    destroy: async () => ({ ok: false, kind: "refused", detail: "Refused.", retryable: false }),
  };
  const r = await applyDiff(repo, { added: [], changed: [], removed: ["a"] });
  yes(/while deleting one record/.test(r.detail));
});

t("visit proposals are never deleted", () => {
  
  const text = require("node:fs").readFileSync(new URL("../src/lib/sync.js", import.meta.url), "utf8");
  yes(/Proposals are never deleted/.test(text));
  yes(!/visitsRepo\.destroy/.test(text), "a refused date is the record and must survive");
});

await new Promise((r) => setTimeout(r, 30));
console.log(`\n  ${pass} passed, ${bad} failed\n`);
process.exit(bad ? 1 : 0);
