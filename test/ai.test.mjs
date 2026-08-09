/* The matcher decides what a clip is recorded as, so it is worth testing that
   it says nothing rather than something wrong. */
import { clipReadingToFields, clipReadingToPrivacy } from "../src/lib/ai.js";

const ROOM_TYPE = ["sauna", "steam_room", "cold_plunge", "relaxation_lounge"];
const SCENE = ["ambience_no_people", "treatment_in_progress", "resting_after"];
const SHOT_SIZE = ["wide", "medium", "close_up"];
const LIGHTING = ["warm_dim_ambient", "bright_daylight"];
const LABELS = { sauna: "Sauna", steam_room: "Steam room", cold_plunge: "Cold plunge",
  relaxation_lounge: "Relaxation lounge", ambience_no_people: "Empty room",
  treatment_in_progress: "Treatment happening", resting_after: "Resting afterwards",
  wide: "Wide", medium: "Medium", close_up: "Close up",
  warm_dim_ambient: "Warm and dim", bright_daylight: "Bright daylight" };
const label = (v) => LABELS[v] ?? v;
const V = { ROOM_TYPE, SCENE, SHOT_SIZE, LIGHTING, label };

let pass = 0, fail = 0;
const is = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log("  ok   " + name); }
  else { fail++; console.log("  FAIL " + name + "\n       got  " + JSON.stringify(got) + "\n       want " + JSON.stringify(want)); }
};

let r = clipReadingToFields({ room: "Sauna", action: "Empty room", framing: "Wide",
  lighting: "Warm and dim", quality_notes: "" }, V);
is("an exact label matches", r.fields.room_type?.value, "sauna");
is("the scene comes back as a list", r.fields.scene?.value, ["ambience_no_people"]);
is("nothing was left over", r.unmatched, []);

r = clipReadingToFields({ room: "the steam room", action: "someone resting afterwards" }, V);
is("a phrase containing the label matches", r.fields.room_type?.value, "steam_room");
is("so does a longer scene phrase", r.fields.scene?.value, ["resting_after"]);

r = clipReadingToFields({ room: "hallway", action: "walking through" }, V);
is("a word outside the vocabulary is not forced", r.fields.room_type, undefined);
is("it is reported rather than dropped", r.unmatched.includes("hallway"), true);

r = clipReadingToFields({}, V);
is("an empty answer produces no fields", r.fields, {});

is("a recognisable face blocks", clipReadingToPrivacy({ face_recognisable: true }).blocked, true);
is("an explicit no does not block", clipReadingToPrivacy({ face_recognisable: false }).blocked, false);
is("a missing answer blocks", clipReadingToPrivacy({ people_visible: true }).blocked, true);
is("an unreadable answer blocks", clipReadingToPrivacy(null).blocked, true);

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
