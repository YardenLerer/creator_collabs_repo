/* Renders a clip the browser could not open, in every failure kind. */
global.window = { storage: undefined };
global.document = { createElement:(t)=>({tagName:t,style:{},setAttribute(){},appendChild(){},remove(){},addEventListener(){},removeEventListener(){},canPlayType:()=>""}), head:{appendChild(){}}, documentElement:{setAttribute(){},removeAttribute(){}} };
const React = require("react"); const { renderToString } = require("react-dom/server"); const M = require("./out.cjs");
const gaps = M.SEED_GAPS.map(M.makeGap); const creators = M.SEED_CREATORS.map(M.makeCreator);
const collab = M.buildWorkedExample(gaps, creators);
let bad = 0;
for (const kind of ["unsupported","network","decode","timeout","empty_canvas","no_dimensions","load_failed"]) {
  const clip = M.makeClip({ collab_id: collab.id, filename: "IMG_4471.MOV", clip_status: "unreadable_file",
    read_failure: { kind, plain: "raw message", probe: { verdict: "likely_unreadable_apple" }, steps: ["01 file …","02 FAILED"] } });
  try {
    const h = renderToString(React.createElement(M.ClipCard, { clip, shotList: collab.brief_shot_list, gaps,
      identity: "Yarden", onPatch: ()=>{}, onDelete: ()=>{}, onAnalyse: ()=>{}, onMakeGap: ()=>{}, busy: false,
      showTechnical: false, defaultOpen: true }));
    const text = h.replace(/<[^>]*>/g, " ");
    const raw = [...new Set((text.match(/\b[a-z]{2,}(?:_[a-z0-9]+)+\b/g) || []))];
    console.log(`  ok   ${kind.padEnd(14)} ${raw.length ? "RAW: " + raw.join(",") : ""}`);
    if (raw.length) bad++;
  } catch (e) { bad++; console.log(`  FAIL ${kind.padEnd(14)} ${e.message}`); }
}
console.log("\n" + M.resendMessage({ filename: "IMG_4471.MOV" }).split("\n")[0]);
process.exit(bad ? 1 : 0);
