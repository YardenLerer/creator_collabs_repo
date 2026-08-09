/* Renders the library against rows shaped exactly like the ones in the
   database, to reproduce the crash rather than guess at it. */
const React = require("react");
const { renderToString } = require("react-dom/server");
const A = require("./out.cjs");

const creators = [{ id: "crt_1", display_name: "Maya Okonkwo", photo: "https://images.pexels.com/x.jpg" }];
const row = (i, over = {}) => ({
  id: `clip_s${i}`, collab_id: "clb_1", branch_id: "br_sj", filename: `IMG_${i}.mov`,
  clip_status: "accepted",
  thumbs: ["https://images.pexels.com/a.jpg", "https://images.pexels.com/b.jpg", "https://images.pexels.com/c.jpg"],
  thumb_paths: [], frame_count: 3, loaded_via: "blob URL",
  system: { duration: 9, width: 1080, height: 1350, aspect_native: "vertical_9_16",
    duration_bucket: "under_15s", capture_source: "phone" },
  ai: { room_type: { value: "sauna", confidence: "high" },
        scene: { value: ["ambience_no_people"], confidence: "high" } },
  ai_status: "sample", quality_flags: [], privacy_flags: [], privacy_status: "cleared",
  accepted_by: "Yarden", accepted_at: new Date().toISOString(),
  rights: { channels: ["organic_owned"], expires_at: "2027-08-03", entered_by: "Yarden" },
  creator_id: "crt_1", sample: { source: "pexels", note: "Placeholder" },
  ...over,
});

const cases = [
  ["a normal library", [row(1), row(2)]],
  ["a row with no rights at all", [row(3, { rights: null })]],
  ["a row with no system block", [row(4, { system: null })]],
  ["a row with no ai", [row(5, { ai: null, ai_status: null })]],
  ["a row whose creator is missing", [row(6, { creator_id: "gone" })]],
  ["an empty library", []],
  // The library is a view. It returns no privacy_flags column at all, and the
  // rows are not put through shapeClip, so this is what the screen really gets.
  ["a row straight from the view, with no privacy_flags key", [(() => {
    const r = row(7); delete r.privacy_flags; return r;
  })()]],
  ["a row with no quality_flags either", [(() => {
    const r = row(8); delete r.privacy_flags; delete r.quality_flags; return r;
  })()]],
];

let bad = 0;
for (const [name, library] of cases) {
  try {
    const html = renderToString(React.createElement(A.LibraryScreen, {
      library, creators, gaps: [], edits: [], editClips: [],
      onGo() {}, onNewGap() {}, thumbUrls: {}, onReadAll() {},
    }));
    console.log(`  ok   ${name} — ${html.length} chars`);
  } catch (e) {
    bad++;
    console.log(`  FAIL ${name}\n       ${e.message}`);
    console.log("       " + (e.stack || "").split("\n")[1]);
  }
}

// The edits section is the newest thing on this screen, and the one the user
// had never seen before it started crashing.
const edits = [
  { id: "e1", title: "Spring reset reels", purpose: "For Instagram", editor: "Dana Kaufman",
    status: "in_edit", due_at: "2026-08-18", published_at: null },
  { id: "e2", title: "Sauna launch film", purpose: null, editor: "Omar Reyes",
    status: "waiting_on_you", due_at: null, published_at: null },
  { id: "e3", title: "Odd one", purpose: null, editor: "Nobody", status: "unknown_state",
    due_at: null, published_at: null },
];
const editClips = [
  { edit_id: "e1", library_id: "clip_s1", position: 1 },
  { edit_id: "e1", library_id: "missing_clip", position: 2 },
  { edit_id: "e2", library_id: "clip_s2", position: 1 },
];

for (const [name, args] of [
  ["edits with clips in them", { library: [row(1), row(2)], edits, editClips }],
  ["an edit pointing at a clip that is gone", { library: [], edits, editClips }],
]) {
  try {
    const html = renderToString(React.createElement(A.LibraryScreen, {
      creators, gaps: [], onGo() {}, onNewGap() {}, thumbUrls: {}, onReadAll() {}, ...args,
    }));
    console.log(`  ok   ${name} — ${html.length} chars`);
  } catch (e) {
    console.log(`  FAIL ${name}\n       ${e.message}`);
    console.log("       " + (e.stack || "").split("\n")[1]);
  }
}

process.exit(bad ? 1 : 0);
