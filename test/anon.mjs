/* A brand new browser: nothing in local storage, no build-time env.
 *
 * This is the reviewer's first second. What has to appear is the product, not
 * a form asking for two values they do not have. */
import { JSDOM } from "jsdom";
import React, { act } from "react";
import { createRoot } from "react-dom/client";

const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>",
  { url: "https://example.test/", pretendToBeVisual: true });
for (const k of ["window","document","HTMLElement","Element","Node","getComputedStyle",
  "requestAnimationFrame","cancelAnimationFrame","MutationObserver","Image","Blob","File","FileReader","matchMedia"])
  Object.defineProperty(globalThis, k, { value: dom.window[k], writable: true, configurable: true });
Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, writable: true, configurable: true });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// Deliberately empty. No saved connection.
dom.window.localStorage.clear();

let sawUrl = null;
globalThis.fetch = async (url) => {
  sawUrl ??= String(url);
  const t = String(url).match(/\/rest\/v1\/([a-z_]+)/)?.[1];
  const rows = t === "gaps"
    ? [{ id: "g1", status: "open", quantity_needed: 4, room_type: ["sauna"], scene: [],
         branch_id: [], aspect: [], shot_size: [], lighting: [], priority: "p0", created_at: "2026-07-01" }]
    : [];
  return { ok: true, status: 200, headers: { get: () => null },
    json: async () => rows, text: async () => JSON.stringify(rows) };
};

const { App } = await import("./out.cjs");
const root = createRoot(document.getElementById("root"));
const quiet = console.error; console.error = () => {};
await act(async () => { root.render(React.createElement(App)); });
for (let i = 0; i < 6; i++) await act(async () => { await new Promise((r) => setTimeout(r, 90)); });
console.error = quiet;

const html = document.getElementById("root").innerHTML;
const text = html.replace(/<[^>]*>/g, " ");
let bad = 0;
const ok = (n, c) => { c ? console.log("  ok   " + n) : (bad++, console.log("  FAIL " + n)); };

ok("no connect form on first load", !/Connect to your database/.test(text));
ok("it reached the product", /of what we asked for is in hand|Today/.test(text));
ok("it called the demonstration project", /kkvboruhfkllhjapqhny\.supabase\.co/.test(sawUrl ?? ""));
ok("it is not stuck on loading", !/Reading everything from the database/.test(text));
ok("it did not land on the failure screen", !/This could not open/.test(text));

process.exit(bad ? 1 : 0);
