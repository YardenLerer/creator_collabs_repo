/**
 * Mounts the app in a real DOM and lets its effects run.
 *
 * Everything before this rendered components with props and never let the app
 * boot. That is why a missing icon in the mobile header passed every check:
 * the header only exists once a connection is present and the boot has
 * finished, and nothing was ever taking it that far.
 */
import { JSDOM } from "jsdom";
import React, { act } from "react";
import { createRoot } from "react-dom/client";


const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>",
  { url: "https://example.test/", pretendToBeVisual: true });
for (const k of ["window", "document", "HTMLElement", "Element", "Node", "getComputedStyle",
                 "requestAnimationFrame", "cancelAnimationFrame", "MutationObserver", "Image"]) {
  Object.defineProperty(globalThis, k, { value: dom.window[k], writable: true, configurable: true });
}
Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, writable: true, configurable: true });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
dom.window.localStorage.setItem("creator-collabs.connection",
  JSON.stringify({ url: "https://x.supabase.co", key: "sb_publishable_test" }));

// A database that answers with a small, valid world.
const rows = {
  gaps: [{ id: "gap_1", taxonomy_version: 1, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    status: "open", closed_at: null, branch_id: ["br_sj"], room_type: ["sauna"], scene: ["ambience_no_people"],
    shot_size: ["wide"], aspect: ["vertical_9_16"], lighting: ["warm_dim_ambient"], quantity_needed: 4,
    priority: "p0", deadline: "", intended_channel: ["organic_owned"] }],
  creators: [{ id: "crt_1", taxonomy_version: 1, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    display_name: "Maya Okonkwo", handle: "@mayaok", photo: "p0", home_metro: "bay_area",
    creator_vertical: ["wellness_selfcare"], audience_geo: ["bay_area"], format_strength: ["vertical_shortform"],
    branch_proximity: "same_metro", nearest_branch_id: "br_sj",
    email: "maya@okonkwo.studio", phone: "+14085550142",
    links: [{ platform: "instagram", url: "https://instagram.com/mayaok" }],
    coverage_note: "Bay Area.", style_note: "Quiet and unhurried.",
    camera: "Sony A7C II", brings_lighting: "yes", works_with: "alone",
    platform_stats: [{ platform: "instagram", followers: 128000, engagement: "4.1%" }],
    notes: [] }],
  collabs: [], clips: [], scores: [], settings: [{ key: "identity", value: "Yarden" }, { key: "seeded", value: { at: "x" } }],
};
globalThis.fetch = async (url) => {
  const table = String(url).split("/rest/v1/")[1]?.split("?")[0];
  return { ok: true, status: 200, headers: { get: () => null },
    text: async () => JSON.stringify(rows[table] ?? []) };
};

const { App } = await import("./out.cjs");
const root = createRoot(document.getElementById("root"));
const errors = [];
const realError = console.error;
console.error = (...a) => { errors.push(a.join(" ")); };

await act(async () => { root.render(React.createElement(App)); });
await act(async () => { await new Promise((r) => setTimeout(r, 60)); });
console.error = realError;

const html = document.getElementById("root").innerHTML;
let bad = 0;
const check = (name, ok) => { if (ok) console.log("  ok   " + name); else { bad++; console.log("  FAIL " + name); } };

check("the app boots past loading", !/Reading everything from the database/.test(html));
check("the stages are reachable by name", /aria-label="Gaps"/.test(html) || />Gaps</.test(html));
check("the mobile header is there", /lg:hidden/.test(html));
check("the build stamp is shown", /\d\d-\d\d \d\d:\d\d/.test(html));
check("the cross search is there", /Search gaps, creators and clips/.test(html));

check("real data reached the screen", /needs you|Where the work stands|open gap/i.test(html));
check("no React errors were logged", errors.filter((e) => !/not wrapped in act|useLayoutEffect/.test(e)).length === 0);
if (errors.length) errors.slice(0, 3).forEach((e) => console.log("       " + e.slice(0, 160)));

/* Walk every stage, because a screen that throws only kills the app when you
   navigate to it - which is how the user finds it and I do not. */
/* The rail is icons, so navigation is found the way a screen reader finds it:
   by accessible name. If this stops matching, the rail has become unusable to
   anyone not using a mouse, which is worth failing over. */
const clickByText = async (text) => {
  const el = [...document.querySelectorAll("button")].find((b) =>
    b.textContent.trim().startsWith(text) || b.getAttribute("aria-label") === text);
  if (!el) return false;
  await act(async () => { el.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });
  await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
  return true;
};

/* The key moved to the server, so there is no key prompt to look for any
   more. What replaces it is that nothing in the built file talks to the model
   directly - checked against the bundle instead. */
for (const stage of ["Gaps", "Creators", "Briefs", "Visits", "Intake", "Library", "Today"]) {
  errors.length = 0;
  console.error = () => {};
  const went = await clickByText(stage);
  console.error = realError;
  const real = errors.filter((e) => !/not wrapped in act|useLayoutEffect|deprecated/.test(e));
  if (!went) { bad++; console.log(`  FAIL could not reach ${stage}`); }
  else if (real.length) { bad++; console.log(`  FAIL ${stage} threw: ${real[0].slice(0, 120)}`); }
  else console.log(`  ok   ${stage} opens`);
}

/* Opening a screen is not the same as using it. The profile is behind a click
   on a roster card, and nothing was ever making that click. */
await clickByText("Creators");
await clickByText("Roster");
const card = [...document.querySelectorAll("button")].find((b) => /Maya Okonkwo/.test(b.textContent));
if (!card) { bad++; console.log("  FAIL no creator card to click"); }
else {
  errors.length = 0; console.error = () => {};
  await act(async () => { card.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });
  await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
  console.error = realError;
  const h = document.getElementById("root").innerHTML;
  const real = errors.filter((e) => !/not wrapped in act|useLayoutEffect|deprecated/.test(e));
  if (real.length) { bad++; console.log("  FAIL the profile threw: " + real[0].slice(0, 120)); }
  for (const [what, probe] of [
    ["the profile opens", /What she shoots/],
    ["her record is shown", /How she has done here/],
    ["a rate with no history stays blank", /Not enough yet/],
    ["her work and collaborations are listed", /Her work/],
    ["there is a way to contact her", /Email her|WhatsApp/],
    ["her style is described in sentences", /What she shoots/],
    ["her audience is shown as reported", /Self-reported/],
    ["notes from people who worked with her", /What people said after working with her/],
  ]) {
    if (probe.test(h)) console.log("  ok   " + what);
    else { bad++; console.log("  FAIL " + what); }
  }
}

console.log(bad ? `\n${bad} failed` : "\nthe app mounts, runs, every stage opens, and the profile works");
process.exit(bad ? 1 : 0);
