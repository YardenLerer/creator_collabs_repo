/* The two questions START_HERE says decide whether the old layer is gone. */
import { JSDOM } from "jsdom";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>",
  { url: "https://example.test/", pretendToBeVisual: true });
for (const k of ["window","document","HTMLElement","Element","Node","getComputedStyle",
                 "requestAnimationFrame","cancelAnimationFrame","MutationObserver","Image"])
  Object.defineProperty(globalThis, k, { value: dom.window[k], writable: true, configurable: true });
Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, writable: true, configurable: true });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
dom.window.localStorage.setItem("creator-collabs.connection",
  JSON.stringify({ url: "https://x.supabase.co", key: "sb_publishable_test" }));
globalThis.fetch = async () => ({ ok: true, status: 200, headers: { get: () => null }, text: async () => "[]" });

const { App } = await import("./out.cjs");
const e = console.error; console.error = () => {};
createRoot(document.getElementById("root")).render(React.createElement(App));
await act(async () => { await new Promise((r) => setTimeout(r, 60)); });
console.error = e;

const bg = dom.window.getComputedStyle(document.body).backgroundColor;
const hasCcRoot = [...document.styleSheets].some((s) => {
  try { return [...s.cssRules].some((r) => r.cssText.includes("cc-root")); } catch { return false; }
});
console.log("getComputedStyle(document.body).backgroundColor =", JSON.stringify(bg));
console.log("any stylesheet rule containing 'cc-root'          =", hasCcRoot);
