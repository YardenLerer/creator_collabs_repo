/* Mounts the app and clicks Intake the way a person does. */
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
dom.window.localStorage.setItem("creator-collabs.connection",
  JSON.stringify({ url: "https://x.supabase.co", key: "sb_publishable_test" }));

const px = (n) => `https://images.pexels.com/photos/${n}/x.jpeg`;
const clip = (i, over = {}) => ({
  id: `clip_${i}`, collab_id: "clb_1", branch_id: "br_sj", filename: `IMG_${i}.mov`,
  clip_status: "analysed", thumbs: [px(i), px(i+1), px(i+2)], thumb_paths: [], frame_count: 3,
  loaded_via: "blob URL",
  system: { duration: 9, aspect_native: "vertical_9_16", duration_bucket: "under_15s",
    width: 1080, height: 1350, capture_source: "phone" },
  ai: { room_type: { value: "sauna", confidence: "high" },
        scene: { value: ["ambience_no_people"], confidence: "high" } },
  ai_status: "sample", quality_flags: [], privacy_flags: [], privacy_status: "cleared",
  match: { level: "exact", gap_id: "g1" }, ...over,
});

const TABLES = {
  gaps: [{ id: "g1", status: "open", quantity_needed: 4, room_type: ["sauna"], scene: ["ambience_no_people"],
    branch_id: ["br_sj"], aspect: ["vertical_9_16"], shot_size: [], lighting: [], priority: "p0",
    due_date: null, created_at: "2026-07-01" }],
  creators: [{ id: "crt_1", display_name: "Maya Okonkwo", handle: "@mayaok", photo: px(9),
    nearest_branch_id: "br_sj", creator_vertical: ["wellness_selfcare"],
    format_strength: ["vertical_shortform"], links: [], platform_stats: [], audience_geo: [], notes: [] }],
  collabs: [{ id: "clb_1", creator_id: "crt_1", branch_id: "br_sj", gap_ids: ["g1"], stage: "intake",
    rights: { channels: ["organic_owned"], entered_by: "Yarden", expires_at: "2027-01-01" },
    brief_approved_by: "Yarden", brief_approved_at: "2026-08-03",
    shot_items: [{ id: "s1", collab_id: "clb_1", gap_id: "g1", room_type: "sauna",
      scene: ["ambience_no_people"], aspect: "vertical_9_16", count: 4, position: 1 }],
    visit_proposals: [{ id: "vp1", collab_id: "clb_1", date: "2026-08-05", time_of_day: "morning",
      duration: "60m", status: "accepted", proposed_by: "Yarden", proposed_at: "2026-08-02" }],
    created_at: "2026-08-01" }],
  clips: [clip(1), clip(2), clip(3, { clip_status: "uploaded", ai: null })],
  scores: [], settings: [{ key: "seeded", value: "true" }],
  library: [], edits: [], edit_clips: [], shot_items: [], visit_proposals: [],
  clip_privacy_flags: [], activity_log: [],
};

globalThis.fetch = async (url) => {
  const t = String(url).match(/\/rest\/v1\/([a-z_]+)/)?.[1];
  const body = TABLES[t] ?? [];
  return { ok: true, status: 200, headers: { get: () => null },
    json: async () => body, text: async () => JSON.stringify(body) };
};

const { App } = await import("./out.cjs");
const root = createRoot(document.getElementById("root"));
const quiet = console.error; console.error = () => {};
await act(async () => { root.render(React.createElement(App)); });
await act(async () => { await new Promise((r) => setTimeout(r, 140)); });

const btn = [...document.querySelectorAll("button")].find((b) => /^Intake/.test(b.textContent || ""));
console.error = quiet;
if (!btn) { console.log("  FAIL no Intake button"); process.exit(1); }

try {
  console.error = () => {};
  await act(async () => { btn.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });
  await act(async () => { await new Promise((r) => setTimeout(r, 100)); });
  console.error = quiet;
} catch (e) {
  console.error = quiet;
  console.log("  FAIL intake crashed on click");
  console.log("       " + e.message);
  console.log("       " + (e.stack || "").split("\n").slice(1, 3).join("\n       "));
  process.exit(1);
}
const text = document.body.textContent || "";
console.log("  ok   intake opened");
console.log("       title:", /Footage that came back/.test(text));
console.log("       decide section:", /Decide on these/.test(text));
console.log("       visit picker:", /Maya Okonkwo/.test(text));
