/* Scans rendered HTML for any snake_case value that leaked into visible text. */
global.window = { storage: undefined };
global.document = { createElement:(t)=>({tagName:t,style:{},setAttribute(){},appendChild(){},remove(){},addEventListener(){},removeEventListener(){}}), head:{appendChild(){}}, documentElement:{setAttribute(){},removeAttribute(){}} };
const React = require("react"); const { renderToString } = require("react-dom/server"); const M = require("./out.cjs");
const gaps = M.SEED_GAPS.map(M.makeGap); const creators = M.SEED_CREATORS.map(M.makeCreator);
const collab = M.buildWorkedExample(gaps, creators);
const noop = () => {};

/* The screens take their helpers as props - that is what let them move into
   their own files. The app hands these over; a test that renders one on its
   own has to do the same, or it is testing a contract nobody uses. */
const DEPS = {
  label: M.label, branchById: M.branchById, fmtDate: M.fmtDate, now: M.now,
  acceptedProposal: M.acceptedProposal, thumbsFor: M.thumbsFor,
  clipSentence: M.clipSentence, gapSentence: M.gapSentence,
  creatorRecord: M.creatorRecord, briefFingerprint: M.briefFingerprint,
  uncoveredChannels: M.uncoveredChannels, ScreenIntro: M.ScreenIntro,
  EmptyState: M.EmptyState, NextStep: M.NextStep, Avatar: M.Avatar, Thumb: M.Thumb,
  Speciality: M.Speciality, Recommendation: M.Recommendation,
  CreatorCard: M.CreatorCard, CreatorProfile: M.CreatorProfile,
  CollabDetail: M.CollabDetail, ProposeDate: M.ProposeDate,
  BRANCHES: M.BRANCHES, TIME_OF_DAY: M.TIME_OF_DAY, VISIT_DURATION: M.VISIT_DURATION,
  SCENE_WORD: M.SCENE_WORD,
};

const screens = {
  Gaps: [M.GapsScreen, { gaps, setGaps:noop, clips:[], creators, scores:{}, collabs:[collab], onOpenMatching:noop, onGo:noop, focus:null, onClearFocus:noop, showTechnical:false }],
  Roster: [M.CreatorsScreen, { creators, setCreators:noop, gaps, scores:{}, setScores:noop, focusGapId:null, setFocusGapId:noop, tab:"roster", setTab:noop, onStartCollab:noop, onGo:noop, showTechnical:false }],
  BriefDetail: [M.BriefsScreen, { collabs:[collab], setCollabs:noop, gaps, creators, identity:"Yarden", selectedId:collab.id, setSelectedId:noop, onGo:noop, showTechnical:false }],
  Visits: [M.VisitsScreen, { collabs:[collab], setCollabs:noop, gaps, creators, identity:"Yarden", onGo:noop, focus:null, onClearFocus:noop }],
};
let leaks = 0;
for (const [name, [C, props]] of Object.entries(screens)) {
  const html = renderToString(React.createElement(C, { ...DEPS, ...props }));
  const text = html.replace(/<[^>]*>/g, "\u0001").split("\u0001").join(" ");
  const found = [...new Set((text.match(/\b[a-z]{2,}(?:_[a-z0-9]+)+\b/g) || []))];
  if (found.length) { leaks += found.length; console.log("  LEAK", name, "->", found.join(", ")); }
  else console.log("  clean", name);
}
console.log(leaks ? `\n${leaks} raw value(s) visible on screen` : "\nno raw values visible anywhere");
process.exit(leaks ? 1 : 0);
