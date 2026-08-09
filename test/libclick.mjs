/* Mounts the real app against rows shaped like the database, then clicks
   Library the way a person does. Server rendering passed while the user's
   screen crashed, so the difference has to be found in the browser path. */
import { JSDOM } from "jsdom";
import React, { act } from "react";
import { createRoot } from "react-dom/client";

const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>",
  { url: "https://example.test/", pretendToBeVisual: true });
for (const k of ["window","document","HTMLElement","Element","Node","getComputedStyle",
  "requestAnimationFrame","cancelAnimationFrame","MutationObserver","Image","Blob","File","FileReader"])
  Object.defineProperty(globalThis, k, { value: dom.window[k], writable: true, configurable: true });
Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, writable: true, configurable: true });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
dom.window.localStorage.setItem("creator-collabs.connection",
  JSON.stringify({ url: "https://x.supabase.co", key: "sb_publishable_test" }));

const px = (n) => `https://images.pexels.com/photos/${n}/x.jpeg`;
const libRow = (i) => ({
  id: `clip_s${i}`, collab_id: "clb_1", branch_id: "br_sj", filename: `IMG_${i}.mov`,
  clip_status: "accepted", thumbs: [px(i), px(i + 1), px(i + 2)], thumb_paths: [],
  frame_count: 3, loaded_via: "blob URL",
  system: { duration: 9, aspect_native: "vertical_9_16", duration_bucket: "under_15s",
    width: 1080, height: 1350, capture_source: "phone" },
  ai: { room_type: { value: "sauna", confidence: "high" },
        scene: { value: ["ambience_no_people"], confidence: "high" } },
  ai_status: "sample", quality_flags: [], privacy_status: "cleared", privacy_reason: null,
  accepted_by: "Yarden", accepted_at: "2026-08-08T10:00:00Z",
  rights: { channels: ["organic_owned"], expires_at: "2027-08-03", entered_by: "Yarden" },
  rights_status: "active", creator_id: "crt_1", sample: { source: "pexels" },
});

const TABLES = {
  gaps: [], creators: [{ id: "crt_1", display_name: "Maya Okonkwo", handle: "@mayaok",
    photo: px(9), nearest_branch_id: "br_sj", creator_vertical: ["wellness_selfcare"],
    format_strength: ["vertical_9_16"], links: [], platform_stats: [], audience_geo: [], notes: [] }],
  collabs: [], clips: [libRow(1)], scores: [], settings: [{ key: "seeded", value: "true" }],
  library: [libRow(1), libRow(2), libRow(3)],
  edits: [{ id: "e1", title: "Spring reset reels", purpose: "For Instagram",
    editor: "Dana Kaufman", status: "in_edit", due_at: "2026-08-18", published_at: null }],
  edit_clips: [{ edit_id: "e1", library_id: "clip_s1", position: 1 }],
  shot_items: [], visit_proposals: [], clip_privacy_flags: [], activity_log: [],
};

globalThis.fetch = async (url) => {
  const table = String(url).match(/\/rest\/v1\/([a-z_]+)/)?.[1];
  const body = TABLES[table] ?? [];
  return { ok: true, status: 200, headers: { get: () => null }, json: async () => body,
    text: async () => JSON.stringify(body) };
};

const { App } = await import("./out.cjs");
const errors = [];
const realError = console.error;
console.error = (...a) => { const s = a.join(" "); if (/Error|error/.test(s)) errors.push(s.slice(0, 200)); };

const root = createRoot(document.getElementById("root"));
await act(async () => { root.render(React.createElement(App)); });
await act(async () => { await new Promise((r) => setTimeout(r, 120)); });

const findButton = (re) => [...document.querySelectorAll("button")]
  .find((b) => re.test(b.textContent || ""));

const nav = findButton(/^Library/);
console.error = realError;

if (!nav) { console.log("  FAIL no Library button in the sidebar"); process.exit(1); }

let crashed = null;
try {
  console.error = () => {};
  await act(async () => { nav.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });
  await act(async () => { await new Promise((r) => setTimeout(r, 80)); });
} catch (e) {
  crashed = e;
} finally { console.error = realError; }

const text = document.body.textContent || "";
if (crashed) {
  console.log("  FAIL the library crashed on click");
  console.log("       " + crashed.message);
  console.log("       " + (crashed.stack || "").split("\n")[1]);
  process.exit(1);
}
console.log("  ok   the library opened");
console.log("       title present:", /library|Everything we/i.test(text));
console.log("       clip cards:", (text.match(/Sauna/g) || []).length);
console.log("       edits section:", /editors are cutting/i.test(text));
