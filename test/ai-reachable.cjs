/* Every model capability has to be reachable from a screen. Three of them have
   been lost twice now - not because the code went, but because the button that
   called it did - so the test checks the button, not the function. */
const React = require("react");
const { renderToString } = require("react-dom/server");
const A = require("./out.cjs");

const DEPS = {
  label: A.label, branchById: A.branchById, fmtDate: A.fmtDate, now: A.now,
  acceptedProposal: A.acceptedProposal, thumbsFor: A.thumbsFor,
  clipSentence: A.clipSentence, gapSentence: A.gapSentence,
  creatorRecord: A.creatorRecord, briefFingerprint: A.briefFingerprint,
  uncoveredChannels: A.uncoveredChannels, ScreenIntro: A.ScreenIntro,
  EmptyState: A.EmptyState, NextStep: A.NextStep, Avatar: A.Avatar, Thumb: A.Thumb,
  Speciality: A.Speciality, Recommendation: A.Recommendation,
  CreatorCard: A.CreatorCard, CreatorProfile: A.CreatorProfile,
  CollabDetail: A.CollabDetail, ProposeDate: A.ProposeDate,
  BRANCHES: A.BRANCHES, TIME_OF_DAY: A.TIME_OF_DAY, VISIT_DURATION: A.VISIT_DURATION,
  SCENE_WORD: A.SCENE_WORD,
};

const gaps = A.SEED_GAPS.map(A.makeGap);
const creators = A.SEED_CREATORS.map(A.makeCreator);
const collab = { ...A.buildWorkedExample(gaps, creators),
  // Intake only shows a visit whose brief was approved, which is the product
  // rule, so the fixture has to satisfy it rather than the screen relax it.
  brief_approved_by: "Yarden", brief_approved_at: new Date().toISOString() };
const clip = A.makeClip({ collab_id: collab.id, branch_id: "br_sj",
  thumbs: ["data:image/jpeg;base64,x"], frame_count: 1, clip_status: "analysed",
  ai: { room_type: { value: "sauna", confidence: "high" },
        scene: { value: ["ambience_no_people"], confidence: "high" } },
  match: { level: "full", gap_id: gaps[0].id, shot_id: collab.brief_shot_list?.[0]?.id },
  system: { duration: 8, width: 1080, height: 1920, aspect_native: "vertical_9_16",
    duration_bucket: "3_10s", capture_source: "unknown" } });

const noop = () => {};
const render = (C, props) => renderToString(React.createElement(C, { ...DEPS, ...props }));

let bad = 0;
const has = (name, html, phrase) => {
  if (html.includes(phrase)) console.log("  ok   " + name);
  else { bad++; console.log(`  FAIL ${name}\n       nothing on screen says "${phrase}"`); }
};

has("scoring the roster is reachable",
  render(A.CreatorsScreen, { creators, setCreators: noop, gaps, scores: {}, setScores: noop,
    tab: "roster", setTab: noop, onStartCollab: noop, onGo: noop, collabs: [collab], clips: [],
    onScoreCreator: async () => ({ byGap: {} }), identity: "Yarden" }),
  "Score the roster");

has("writing shot instructions is reachable",
  render(A.BriefsScreen, { collabs: [collab], setCollabs: noop, gaps, creators,
    identity: "Yarden", selectedId: collab.id, setSelectedId: noop, onGo: noop,
    draftShotNotes: async () => ({ ok: true, instruction: "x", note: "y" }) }),
  "Write the how");

has("the sample visit is reachable",
  render(A.IntakeScreen, { collabs: [collab], gaps, creators, clips: [], setClips: noop,
    identity: "Yarden", onNewGap: noop, onGo: noop, focus: null, onClearFocus: noop }),
  "Load a sample visit");

has("the proposal panel appears once clips match",
  render(A.IntakeScreen, { collabs: [collab], gaps, creators,
    clips: [clip, { ...clip, id: "c2" }], setClips: noop, identity: "Yarden",
    onNewGap: noop, onGo: noop, focus: null, onClearFocus: noop }),
  "match a gap you wrote");

has("the dashboard is on Today",
  render(A.HomeScreen, { gaps, creators, collabs: [collab], clips: [clip], library: [],
    edits: [], editClips: [], onGo: noop }),
  "of what we asked for is in hand");

console.log(bad ? `\n  ${bad} capability is not reachable` : "\n  every model capability has a way in");
process.exit(bad ? 1 : 0);
