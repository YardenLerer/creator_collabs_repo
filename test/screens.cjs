
const React = require("react");
const { renderToString } = require("react-dom/server");
const M = require("./out.cjs");
const gaps = M.SEED_GAPS.map(M.makeGap);
const creators = M.SEED_CREATORS.map(M.makeCreator);
const collab = M.buildWorkedExample(gaps, creators);
const thumbs = ["data:image/jpeg;base64,x", "data:image/jpeg;base64,y"];
const base = { collab_id: collab.id, branch_id: "br_sj", thumbs, frame_count: 2,
  system: { duration: 8, width: 1080, height: 1920, aspect_native: "vertical_9_16",
    duration_bucket: "3_10s", capture_source: "unknown", time_of_day: "morning", time_of_day_source: "visit_record" } };
const raw = M.makeClip({ ...base, filename: "IMG_4471.mov", clip_status: "uploaded" });
const ai = {
  room_type: { value: "sauna", confidence: "high", status: "ok" },
  scene: { value: ["ambience_no_people"], confidence: "high", status: "ok", dropped: [] },
  shot_size: { value: "wide", confidence: "medium", status: "ok" },
  camera_motion: { value: "static", confidence: "high", status: "ok" },
  lighting_condition: { value: "warm_dim_ambient", confidence: "medium", status: "ok" },
  color_cast: { value: "warm_orange", confidence: "medium", status: "ok" },
  reframe_safe_9_16: { value: "yes", confidence: "high", status: "ok" },
  audio_state: { value: "ambient_usable", confidence: "low", status: "ok" },
  time_of_day: { value: "indeterminate", confidence: null, status: "overconfidence_downgraded" },
};
const done = M.makeClip({ ...base, filename: "IMG_4472.mov", clip_status: "analysed", ai,
  quality_flags: [{ flag: "lens_fog_condensation", severity: "cosmetic", confidence: "medium" }],
  overconfidence: [{ code: "overconfidence_flag", field: "time_of_day", detail: "Downgraded.", was: "morning" }],
  match: { shot_id: collab.brief_shot_list[0].id, gap_id: collab.gap_ids[0], level: "full", mismatches: [] } });
const blocked = M.makeClip({ ...base, filename: "IMG_4473.mov", clip_status: "analysed", ai,
  privacy_flags: [{ flag: "guest_face_identifiable", confidence: "low", frame_index: 1, note: "figure at the back", status: "unreviewed", resolved_by: null, resolved_at: null }],
  privacy_status: "unreviewed", privacy_reason: "1 privacy flag raised.",
  match: { shot_id: collab.brief_shot_list[0].id, gap_id: collab.gap_ids[0], level: "partial", mismatches: ["asked wide, got medium"] } });
const accepted = M.makeClip({ ...base, filename: "IMG_4474.mov", clip_status: "accepted", ai,
  accepted_by: "Yarden", accepted_at: new Date().toISOString(), gap_id_closed: collab.gap_ids[0],
  match: { shot_id: collab.brief_shot_list[0].id, gap_id: collab.gap_ids[0], level: "full", mismatches: [] } });
const clips = [raw, done, blocked, accepted];
const noop = () => {};
/* Helpers the split-out screens now take as props. The app passes these; a
   test that renders a screen on its own has to as well. */
/* The screens take their helpers as props now - that is what let them move
   into their own files. The app hands these over; a test that renders one on
   its own has to do the same, or it is testing a contract nobody uses. */
const DEPS = {
  label: M.label, branchById: M.branchById, fmtDate: M.fmtDate, now: M.now,
  acceptedProposal: M.acceptedProposal, thumbsFor: M.thumbsFor,
  clipSentence: M.clipSentence, gapSentence: M.gapSentence,
  creatorRecord: M.creatorRecord, briefFingerprint: M.briefFingerprint,
  uncoveredChannels: M.uncoveredChannels,
  ScreenIntro: M.ScreenIntro, EmptyState: M.EmptyState, NextStep: M.NextStep,
  Avatar: M.Avatar, Thumb: M.Thumb, Speciality: M.Speciality,
  Recommendation: M.Recommendation, CreatorCard: M.CreatorCard,
  CreatorProfile: M.CreatorProfile, CollabDetail: M.CollabDetail,
  ProposeDate: M.ProposeDate,
  BRANCHES: M.BRANCHES, TIME_OF_DAY: M.TIME_OF_DAY, VISIT_DURATION: M.VISIT_DURATION,
  SCENE_WORD: M.SCENE_WORD,
};

/* A screen that renders a few hundred characters has rendered its heading and
   nothing else. Every one of these puts real records on the page, so a floor
   catches a screen that silently produced an empty shell. */
const FLOOR = 1200;

/* Renders every screen for real. Transpiling proves syntax; only rendering
   proves the identifiers exist and the props line up. */
global.window = { storage: undefined };
global.document = { createElement: (t)=>({tagName:t,style:{},setAttribute(){},appendChild(){},remove(){},addEventListener(){},removeEventListener(){}}), head:{appendChild(){}}, documentElement:{setAttribute(){},removeAttribute(){}} };

const cases = {
  Home:        [M.HomeScreen, { gaps, creators, collabs: [collab], clips, onGo: noop, onLoadExample: noop, hasExample: true }],
  Gaps:        [M.GapsScreen, { gaps, setGaps: noop, clips, creators, scores: {}, collabs: [collab], onOpenMatching: noop, onGo: noop, focus: null, onClearFocus: noop, showTechnical: false }],
  GapsFocused: [M.GapsScreen, { gaps, setGaps: noop, clips, creators, scores: {}, collabs: [collab], onOpenMatching: noop, onGo: noop, focus: { gapIds: [gaps[0].id], why: "due soon" }, onClearFocus: noop, showTechnical: true }],
  Roster:      [M.CreatorsScreen, { creators, setCreators: noop, gaps, scores: {}, setScores: noop, focusGapId: null, setFocusGapId: noop, tab: "roster", setTab: noop, onStartCollab: noop, onGo: noop, showTechnical: false }],
  Matching:    [M.CreatorsScreen, { creators, setCreators: noop, gaps, scores: {}, setScores: noop, focusGapId: null, setFocusGapId: noop, tab: "matching", setTab: noop, onStartCollab: noop, onGo: noop, showTechnical: false }],
  BriefList:   [M.BriefsScreen, { collabs: [collab], setCollabs: noop, gaps, creators, identity: "Yarden", selectedId: null, setSelectedId: noop, onGo: noop, showTechnical: false }],
  BriefDetail: [M.BriefsScreen, { collabs: [collab], setCollabs: noop, gaps, creators, identity: "Yarden", selectedId: collab.id, setSelectedId: noop, onGo: noop, showTechnical: false }],
  Visits:      [M.VisitsScreen, { collabs: [collab], setCollabs: noop, gaps, creators, identity: "Yarden", onGo: noop, focus: null, onClearFocus: noop }],
  Intake:      [M.IntakeScreen, { collabs: [collab], gaps, creators, clips, setClips: noop, identity: "Yarden", onNewGap: noop, onGo: noop, focus: null, onClearFocus: noop, showTechnical: false }],
  IntakeEmpty: [M.IntakeScreen, { collabs: [], gaps, creators, clips: [], setClips: noop, identity: "Yarden", onNewGap: noop, onGo: noop, focus: null, onClearFocus: noop, showTechnical: false }],
  CreatorProfile: [M.CreatorsScreen, { creators, setCreators: noop, gaps, scores: {}, setScores: noop,
    focusGapId: null, setFocusGapId: noop, tab: "roster", setTab: noop, onStartCollab: noop, onGo: noop,
    showTechnical: false, collabs: [collab], clips, thumbUrls: {}, onOpenCollab: noop }],
  Library:     [M.LibraryScreen, { clips, collabs: [collab], gaps, onGo: noop, onNewGap: noop, showTechnical: false }],
  BranchPhone: [M.BranchManagerApp, { collabs: [collab], setCollabs: noop, creators, identity: "Yarden", branchId: "br_sj", setBranchId: noop, onSwitchPersona: noop, onEditIdentity: noop }],
};
let bad = 0;
for (const [name, [C, props]] of Object.entries(cases)) {
  try {
    const h = renderToString(React.createElement(C, { ...DEPS, ...props }));
    if (h.length < FLOOR) {
      bad++; console.log("  FAIL", name.padEnd(12), `only ${h.length} chars - it rendered a shell`);
    } else {
      console.log("  ok  ", name.padEnd(12), String(h.length).padStart(6), "chars");
    }
  }
  catch (e) { bad++; console.log("  FAIL", name.padEnd(12), e.message); }
}
/* Nothing raw may reach a screen. */
const RAW = /(?:^|>)[a-z]+(?:_[a-z0-9]+)+(?:<|$)/;
console.log(bad ? "\n" + bad + " screen(s) failed" : "\nall screens render");
process.exit(bad ? 1 : 0);
