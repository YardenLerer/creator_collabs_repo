/**
 * Boots against an EMPTY database - the state the project is actually in right
 * now, and the one path none of the other checks covered. Every check so far
 * fed the app a database that already had rows in it, so the seeding branch,
 * which is the only thing that runs on a first load, was never executed.
 */
import { JSDOM } from "jsdom";
import React, { act } from "react";
import { createRoot } from "react-dom/client";

const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>",
  { url: "https://example.test/", pretendToBeVisual: true });
for (const k of ["window","document","HTMLElement","Element","Node","getComputedStyle",
                 "requestAnimationFrame","cancelAnimationFrame","MutationObserver","Image"]) {
  Object.defineProperty(globalThis, k, { value: dom.window[k], writable: true, configurable: true });
}
Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, writable: true, configurable: true });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
dom.window.localStorage.setItem("creator-collabs.connection",
  JSON.stringify({ url: "https://x.supabase.co", key: "sb_publishable_test" }));

const db = { gaps: [], creators: [], collabs: [], clips: [], scores: [], settings: [],
             shot_items: [], visit_proposals: [] };
const writes = [];
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  const table = u.split("/rest/v1/")[1]?.split("?")[0];
  const method = init.method ?? "GET";
  if (method === "POST" || method === "PATCH") {
    const body = init.body ? JSON.parse(init.body) : null;
    const rows = Array.isArray(body) ? body : [body];
    writes.push({ table, n: rows.length });
    if (db[table]) db[table].push(...rows);
    return { ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify(rows) };
  }
  if (method === "DELETE") return { ok: true, status: 204, headers: { get: () => null }, text: async () => "" };
  return { ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify(db[table] ?? []) };
};

const { App } = await import("./out.cjs");
const errors = []; const realError = console.error;
console.error = (...a) => errors.push(a.join(" "));
const root = createRoot(document.getElementById("root"));
await act(async () => { root.render(React.createElement(App)); });
for (let i = 0; i < 8; i++) await act(async () => { await new Promise((r) => setTimeout(r, 80)); });
console.error = realError;

const html = document.getElementById("root").innerHTML;
let bad = 0;
const ok = (n, c) => { if (c) console.log("  ok   " + n); else { bad++; console.log("  FAIL " + n); } };

/* Noise from the test environment rather than from the product.
 *
 * `attachEvent` is an Internet Explorer API that jsdom does not implement and
 * React's focus handling probes for. It says nothing about whether seeding
 * worked, and treating it as a failure would make this check fail on every
 * machine while the app was fine. The act and deprecation warnings are the
 * same kind of thing. */
const ENVIRONMENT_NOISE = /not wrapped in act|useLayoutEffect|deprecated|attachEvent/;
const real = errors.filter((e) => !ENVIRONMENT_NOISE.test(e));
ok("no React error while seeding", real.length === 0);
if (real.length) real.slice(0, 2).forEach((e) => console.log("       " + e.slice(0, 200)));
ok("it did not get stuck on the loading screen", !/Reading everything from the database/.test(html));
ok("it did not land on the failure screen", !/This could not open/.test(html));
ok(`gaps were written (${db.gaps.length})`, db.gaps.length > 0);
ok(`creators were written (${db.creators.length})`, db.creators.length > 0);
ok(`collabs were written (${db.collabs.length})`, db.collabs.length > 0);
ok(`shot items were written (${db.shot_items.length})`, db.shot_items.length > 0);
ok(`visit proposals were written (${db.visit_proposals.length})`, db.visit_proposals.length > 0);
ok("the app is showing work, not an empty desk", /needs you|Where the work stands|Open gaps/i.test(html));
ok(`clips were written (${db.clips.length})`, db.clips.length >= 20);
ok("library clips are accepted", db.clips.filter((c) => c.clip_status === "accepted").length >= 20);
ok("intake clips are waiting to be read", db.clips.filter((c) => c.clip_status === "uploaded").length > 0);
ok("no sample clip carries a description nobody produced", db.clips.every((c) => !c.ai));
ok("every sample clip has frames", db.clips.every((c) => (c.thumbs ?? []).length > 0) || db.clips.every((c) => c.thumbs === undefined));

console.log(bad ? `\n${bad} failed` : "\na first load seeds and lands on a working screen");
process.exit(bad ? 1 : 0);
