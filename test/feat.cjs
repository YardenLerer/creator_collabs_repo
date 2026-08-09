/* Renders the roster and Today with rows shaped like the database, and checks
   for the things that were just added rather than assuming they appear. */
const React = require("react");
const { renderToString } = require("react-dom/server");
const A = require("./out.cjs");

/* Same seam the screen harness uses: the real helpers, from the module. A
   stub here would render a div and pass while the real card was broken. */
const DEPS = {
  label: A.label, branchById: A.branchById, fmtDate: A.fmtDate, now: A.now,
  acceptedProposal: A.acceptedProposal, thumbsFor: A.thumbsFor,
  clipSentence: A.clipSentence, gapSentence: A.gapSentence,
  creatorRecord: A.creatorRecord, ScreenIntro: A.ScreenIntro,
  EmptyState: A.EmptyState, NextStep: A.NextStep, Avatar: A.Avatar, Thumb: A.Thumb,
  Speciality: A.Speciality, Recommendation: A.Recommendation,
  CreatorCard: A.CreatorCard, CreatorProfile: A.CreatorProfile,
  BRANCHES: A.BRANCHES, SCENE_WORD: A.SCENE_WORD,
};

const creator = {
  id: "crt_1", display_name: "Maya Okonkwo", handle: "@mayaok",
  photo: "https://images.pexels.com/photos/1/x.jpeg",
  nearest_branch_id: "br_sj",
  creator_vertical: ["wellness_selfcare", "beauty_skincare"],
  format_strength: ["vertical_shortform"], links: [], platform_stats: [], audience_geo: [],
  notes: [
    { text: "Arrived early.", by: "Yarden", worked: "yes", at: "2026-08-06T09:12:00Z" },
    { text: "One clip soft.", by: "Nadia", worked: "yes", at: "2026-08-07T14:30:00Z" },
    { text: "Cancelled twice.", by: "Yarden", worked: "no", at: "2026-07-09T08:40:00Z" },
  ],
};

const html = renderToString(React.createElement(A.CreatorsScreen, { ...DEPS, 
  creators: [creator], gaps: [], collabs: [], clips: [], scores: {},
  tab: "roster", setTab() {}, onGo() {}, onStartCollab() {}, setCreators() {}, identity: "Yarden",
}));

const check = (name, ok) => console.log((ok ? "  ok   " : "  FAIL ") + name);
check("speciality chip rendered", /Wellness|wellness/i.test(html) && /#ECFDF5/.test(html));
check("stars rendered", /would book her again/.test(html));
check("star fill uses the warn token", /var\(--warn\)/.test(html));

/* Every colour on a screen has to be a token now, or dark mode moves half the
   page and leaves the other half in daylight. */
const literals = (html.match(/#(?:FFFFFF|FAF9F7|1C1917|78716C|E7E5E4|D6D3D1)\b/gi) || []);
check("no hardcoded palette colours left on the roster", literals.length === 0);
if (literals.length) console.log("       found: " + [...new Set(literals)].join(", "));

const home = renderToString(React.createElement(A.HomeScreen, { ...DEPS, 
  gaps: [{ id: "g1", status: "open", quantity_needed: 6, room_type: ["sauna"], scene: [], branch_id: [], due_date: null }],
  creators: [creator], collabs: [], clips: [], library: [], edits: [], editClips: [],
  onGo() {},
}));
check("dashboard headline", /of what we asked for is in hand/.test(home));
check("pipeline bar", /Where the work is sitting/.test(home));
