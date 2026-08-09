/* ============================================================================
   validation.test.js

   Run:  node validation.test.js
   No install, no test runner, no config. If it prints FAIL, something that
   protects a guest in a robe has stopped working.

   Almost every case here is hostile input. The happy path is checked once, at
   the end, only to prove the layer has not simply started rejecting everything.
============================================================================ */

const assert = require("assert");
/* Against the bundle, not against a copy.
 *
 * There used to be a standalone validation.js that this file imported, and
 * nine of its fourteen functions had drifted from the ones the app actually
 * used - so this suite was green against code nobody shipped. It now reads
 * the same bundle the screens are rendered from. */
const V = require("./out.cjs");

let passed = 0, failed = 0;
const results = [];

function test(name, fn) {
  try { fn(); passed++; results.push(["PASS", name, ""]); }
  catch (e) { failed++; results.push(["FAIL", name, e.message]); }
}

/* The vocabulary we actually send on the description call. */
const FULL_VOCAB = {
  room_type: V.TAXONOMY.ROOM_TYPE,
  scene: V.TAXONOMY.SCENE,
  shot_size: V.TAXONOMY.SHOT_SIZE,
  camera_motion: V.TAXONOMY.CAMERA_MOTION,
  lighting_condition: V.TAXONOMY.LIGHTING_CONDITION,
  color_cast: V.TAXONOMY.COLOR_CAST,
  reframe_safe_9_16: V.TAXONOMY.REFRAME_SAFE,
  audio_state: V.TAXONOMY.AUDIO_STATE,
  time_of_day: V.TAXONOMY.TIME_OF_DAY,
  quality_flag: V.TAXONOMY.QUALITY_FLAG,
};

const good = (over = {}) => ({
  room_type: { value: "relaxation_lounge", confidence: "high" },
  scene: [{ value: "resting_relaxing", confidence: "high" }],
  shot_size: { value: "wide", confidence: "medium" },
  camera_motion: { value: "static", confidence: "high" },
  lighting_condition: { value: "warm_dim_ambient", confidence: "medium" },
  color_cast: { value: "warm_orange", confidence: "medium" },
  reframe_safe_9_16: { value: "partial", confidence: "medium" },
  audio_state: { value: "ambient_usable", confidence: "low" },
  time_of_day: { value: "indeterminate", confidence: "high" },
  quality_flags: [],
  ...over,
});

/* ==========================================================================
   1. A value the model invented
   ========================================================================== */
test("1. invented value is rejected as invented, and only that field falls", () => {
  const r = V.validateDescription(good({ room_type: { value: "meditation_pod", confidence: "high" } }), FULL_VOCAB);
  assert.strictEqual(r.fields.room_type.status, "failed_vocabulary_invented");
  assert.strictEqual(r.fields.room_type.value, null);
  assert.strictEqual(r.ok, false, "a clip with no readable room is not describable");
  // The neighbours survive. One bad field does not poison the record.
  assert.strictEqual(r.fields.shot_size.value, "wide");
  assert.strictEqual(r.fields.lighting_condition.value, "warm_dim_ambient");
  assert.ok(r.issues.some((i) => i.code === "failed_vocabulary_invented" && i.field === "room_type"));
});

/* ==========================================================================
   2. A real taxonomy value that was not sent in this call
   ========================================================================== */
test("2. valid value outside the sent vocabulary is out_of_scope, not invented", () => {
  // Narrowed vocabulary, as happens whenever we trim the prompt.
  const narrowed = { ...FULL_VOCAB, room_type: ["sauna", "steam_room"] };
  const r = V.validateDescription(good({ room_type: { value: "hair_salon", confidence: "high" } }), narrowed);
  assert.strictEqual(r.fields.room_type.status, "failed_vocabulary_out_of_scope");
  assert.notStrictEqual(r.fields.room_type.status, "failed_vocabulary_invented");
  assert.ok(V.ALL_TAXONOMY_VALUES.has("hair_salon"), "hair_salon really is a legal value");
});

test("2b. a value put in the wrong field is out_of_scope, not invented", () => {
  const r = V.validateDescription(good({ shot_size: { value: "sauna", confidence: "high" } }), FULL_VOCAB);
  assert.strictEqual(r.fields.shot_size.status, "failed_vocabulary_out_of_scope");
});

/* ==========================================================================
   3. Doubt in privacy becomes a flag, not silence
   ========================================================================== */
test("3. a low-confidence privacy flag survives and blocks the clip", () => {
  const r = V.validatePrivacy(
    { privacy_flags: [{ flag: "guest_face_identifiable", confidence: "low", frame_index: 2, note: "figure in background" }] },
    { privacy_flag: V.TAXONOMY.PRIVACY_FLAG }
  );
  assert.strictEqual(r.privacy_flags.length, 1, "low confidence must not delete the flag");
  assert.strictEqual(r.privacy_flags[0].confidence, "low");
  assert.strictEqual(r.privacy_flags[0].status, "unreviewed");
  assert.strictEqual(r.review_required, true);
  assert.strictEqual(V.privacyBlocks(r.privacy_flags), true, "unreviewed must block acceptance");
});

test("3b. a privacy flag we could not read still forces review", () => {
  const r = V.validatePrivacy(
    { privacy_flags: [{ flag: "guest_in_towel", confidence: "high" }] },
    { privacy_flag: V.TAXONOMY.PRIVACY_FLAG }
  );
  assert.strictEqual(r.privacy_flags.length, 0, "the unmappable flag is dropped");
  assert.strictEqual(r.review_required, true, "but the clip is NOT treated as clean");
  assert.ok(r.review_reason);
});

test("3c. a broken privacy reply blocks rather than passes", () => {
  const r = V.validatePrivacy(null, { privacy_flag: V.TAXONOMY.PRIVACY_FLAG });
  assert.strictEqual(r.review_required, true);
  const r2 = V.validatePrivacy({}, { privacy_flag: V.TAXONOMY.PRIVACY_FLAG });
  assert.strictEqual(r2.review_required, true, "no privacy_flags key means nothing was checked");
});

/* ==========================================================================
   4. Doubt in quality becomes a cleanup flag, and never blocks
   ========================================================================== */
test("4. a low-confidence quality flag survives as cosmetic", () => {
  const r = V.validateDescription(
    good({ quality_flags: [{ flag: "out_of_focus", severity: "cosmetic", confidence: "low" }] }),
    FULL_VOCAB
  );
  assert.strictEqual(r.quality_flags.length, 1);
  assert.strictEqual(r.quality_flags[0].confidence, "low");
  assert.strictEqual(r.quality_flags[0].severity, "cosmetic");
});

test("4b. blocking severity at low confidence is downgraded, not obeyed", () => {
  const r = V.validateDescription(
    good({ quality_flags: [{ flag: "out_of_focus", severity: "blocking", confidence: "low" }] }),
    FULL_VOCAB
  );
  assert.strictEqual(r.quality_flags[0].severity, "cosmetic");
  assert.ok(r.issues.some((i) => i.code === "downgraded_low_confidence"));
});

test("4c. an illegal severity is downgraded, the flag is kept", () => {
  const r = V.validateDescription(
    good({ quality_flags: [{ flag: "lens_fog_condensation", severity: "catastrophic", confidence: "high" }] }),
    FULL_VOCAB
  );
  assert.strictEqual(r.quality_flags.length, 1);
  assert.strictEqual(r.quality_flags[0].severity, "cosmetic");
});

/* ==========================================================================
   5. Certainty about something the model cannot see
   ========================================================================== */
test("5. definite time of day inside a windowless room is downgraded", () => {
  const r = V.validateDescription(good({
    room_type: { value: "sauna", confidence: "high" },
    time_of_day: { value: "morning", confidence: "high" },
  }), FULL_VOCAB);
  assert.strictEqual(r.fields.time_of_day.value, "indeterminate");
  assert.strictEqual(r.fields.time_of_day.confidence, null);
  assert.strictEqual(r.overconfidence.length, 1);
  assert.strictEqual(r.overconfidence[0].was, "morning");
  assert.strictEqual(r.overconfidence[0].code, "overconfidence_flag");
});

test("5b. the same claim from a room with windows is left alone", () => {
  const r = V.validateDescription(good({
    room_type: { value: "outdoor_pool_deck", confidence: "high" },
    time_of_day: { value: "golden_hour", confidence: "high" },
  }), FULL_VOCAB);
  // golden_hour is a lighting value, not a time value, so it is out of scope.
  assert.strictEqual(r.fields.time_of_day.status, "failed_vocabulary_out_of_scope");
  const r2 = V.validateDescription(good({
    room_type: { value: "outdoor_pool_deck", confidence: "high" },
    time_of_day: { value: "evening", confidence: "high" },
  }), FULL_VOCAB);
  assert.strictEqual(r2.fields.time_of_day.value, "evening");
  assert.strictEqual(r2.overconfidence.length, 0);
});

/* ==========================================================================
   Extras that will actually happen in the field
   ========================================================================== */
test("6. markdown fences around the JSON are survivable", () => {
  const parsed = V.extractJson('```json\n{"room_type":{"value":"sauna"}}\n```');
  assert.strictEqual(parsed.room_type.value, "sauna");
});

test("6b. chatty preamble before the JSON is survivable", () => {
  const parsed = V.extractJson('Here is the analysis you asked for:\n{"a":1}\nHope that helps.');
  assert.strictEqual(parsed.a, 1);
});

test("6c. genuinely unparseable text throws rather than returning junk", () => {
  assert.throws(() => V.extractJson("I could not analyse this video."));
});

test("7. a missing field becomes an explicit unknown, not a guess", () => {
  const g = good(); delete g.lighting_condition; delete g.time_of_day;
  const r = V.validateDescription(g, FULL_VOCAB);
  assert.strictEqual(r.fields.lighting_condition.status, "missing");
  assert.strictEqual(r.fields.lighting_condition.value, null);
  assert.strictEqual(r.fields.lighting_condition.confidence, null);
  assert.strictEqual(r.fields.time_of_day.value, "indeterminate");
});

test("8. missing confidence defaults to low, never medium", () => {
  const r = V.validateDescription(good({ room_type: { value: "sauna" } }), FULL_VOCAB);
  assert.strictEqual(r.fields.room_type.confidence, "low");
});

test("9. an empty reply produces unknowns and a blocked privacy state", () => {
  const d = V.validateDescription({}, FULL_VOCAB);
  assert.strictEqual(d.ok, false);
  assert.ok(d.issues.length >= 8, "every absent field is reported");
  const p = V.validatePrivacy({}, { privacy_flag: V.TAXONOMY.PRIVACY_FLAG });
  assert.strictEqual(p.review_required, true);
});

/* ==========================================================================
   Frames: the path that must never degrade quietly
   ========================================================================== */
test("10. analysis is refused when only thumbnails remain", () => {
  const r = V.canAnalyse("thumbs_only");
  assert.strictEqual(r.allowed, false);
  assert.strictEqual(r.code, "requires_human_review");
  assert.ok(/thumbnail/i.test(r.reason), "the reason has to say why, in words");
});

test("10b. analysis is refused when no frames exist", () => {
  assert.strictEqual(V.canAnalyse("none").allowed, false);
  assert.strictEqual(V.canAnalyse(undefined).allowed, false);
});

test("10c. analysis is allowed only with full resolution frames", () => {
  assert.strictEqual(V.canAnalyse("full").allowed, true);
});

test("11. frame count scales with duration and never samples at zero", () => {
  assert.strictEqual(V.framePlan(3).count, 3);
  assert.strictEqual(V.framePlan(10).count, 4);
  assert.strictEqual(V.framePlan(20).count, 5);
  assert.strictEqual(V.framePlan(45).count, 6);
  assert.strictEqual(V.framePlan(90).count, 7);
  assert.strictEqual(V.framePlan(300).count, 8);
  for (const d of [3, 10, 20, 45, 90, 300]) {
    const p = V.framePlan(d);
    assert.ok(p.positions[0] > 0, "never sample the first frame, it is usually black");
    assert.ok(p.positions[p.positions.length - 1] < 1);
    assert.strictEqual(p.positions.length, p.count);
  }
});

/* ==========================================================================
   The brief diff, which the model never sees
   ========================================================================== */
test("12. a clip in a room nobody asked for is unmatched, not discarded", () => {
  const shots = [{ id: "s1", gap_id: "g1", room_type: "sauna", scene: ["ambience_no_people"], aspect: "vertical_9_16", shot_size: "wide" }];
  const clip = { room_type: { value: "juice_bar" }, scene: { value: ["food_beverage"] }, shot_size: { value: "close_up" }, aspect_native: "vertical_9_16" };
  const m = V.matchClipToShots(clip, clip?.aspect_native ?? "vertical_9_16", shots);
  assert.strictEqual(m.level, "unmatched");
  assert.ok(m.mismatches[0].includes("juice_bar"));
});

test("12b. right room, wrong aspect is partial and says which", () => {
  const shots = [{ id: "s1", gap_id: "g1", room_type: "sauna", scene: ["ambience_no_people"], aspect: "vertical_9_16", shot_size: "wide" }];
  const clip = { room_type: { value: "sauna" }, scene: { value: ["ambience_no_people"] }, shot_size: { value: "wide" }, aspect_native: "horizontal_16_9" };
  const m = V.matchClipToShots(clip, clip?.aspect_native ?? "vertical_9_16", shots);
  assert.strictEqual(m.level, "partial");
  assert.ok(m.mismatches.some((x) => x.includes("horizontal_16_9")));
});

test("12c. everything matching is a full match", () => {
  const shots = [{ id: "s1", gap_id: "g1", room_type: "sauna", scene: ["ambience_no_people"], aspect: "vertical_9_16", shot_size: "wide" }];
  const clip = { room_type: { value: "sauna" }, scene: { value: ["ambience_no_people"] }, shot_size: { value: "wide" }, aspect_native: "vertical_9_16" };
  assert.strictEqual(V.matchClipToShots(clip, clip?.aspect_native ?? "vertical_9_16", shots).level, "full");
});

/* ==========================================================================
   One happy path, last, only to prove the layer has not started rejecting
   everything it sees.
   ========================================================================== */
test("13. a clean reply passes intact", () => {
  const r = V.validateDescription(good(), FULL_VOCAB);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.fields.room_type.value, "relaxation_lounge");
  assert.strictEqual(r.fields.scene.value[0], "resting_relaxing");
  assert.strictEqual(r.overconfidence.length, 0);
  assert.strictEqual(r.issues.filter((i) => i.code.startsWith("failed")).length, 0);
  const p = V.validatePrivacy({ privacy_flags: [] }, { privacy_flag: V.TAXONOMY.PRIVACY_FLAG });
  assert.strictEqual(p.review_required, false);
  assert.strictEqual(V.privacyBlocks(p.privacy_flags), false);
});

/* ==========================================================================
   The reload scenario, end to end. This is the one that the privacy claim
   actually rests on: if it ever analyses quietly from a 256px thumbnail, the
   whole argument collapses.
   ========================================================================== */
function fakeIntake() {
  const sessionFrames = new Map();          // cleared by a reload, on purpose
  const framesAvailableFor = (clip) =>
    sessionFrames.has(clip.id) ? "full" : (clip.thumbs && clip.thumbs.length ? "thumbs_only" : "none");
  let modelCalls = 0;
  const analyseOne = (clip) => {
    const gate = V.canAnalyse(framesAvailableFor(clip));
    if (!gate.allowed) return { ...clip, clip_status: gate.code, blocked_reason: gate.reason };
    modelCalls += 1;                        // stands in for describeClip + checkClipPrivacy
    return { ...clip, clip_status: "analysed" };
  };
  return { sessionFrames, analyseOne, calls: () => modelCalls };
}

test("14. a fresh upload analyses, because the full frames are in memory", () => {
  const it = fakeIntake();
  const clip = { id: "clip_a", thumbs: ["thumb0", "thumb1"] };
  it.sessionFrames.set("clip_a", ["big0", "big1"]);
  const out = it.analyseOne(clip);
  assert.strictEqual(out.clip_status, "analysed");
  assert.strictEqual(it.calls(), 1);
});

test("15. after a reload only thumbnails remain, and analysis REFUSES", () => {
  const it = fakeIntake();
  // Reload: the thumbnails were persisted, the analysis frames were not.
  const clip = { id: "clip_a", thumbs: ["thumb0", "thumb1"] };
  assert.strictEqual(it.sessionFrames.has("clip_a"), false, "the session map must start empty");
  const out = it.analyseOne(clip);
  assert.strictEqual(out.clip_status, "requires_human_review");
  assert.strictEqual(it.calls(), 0, "NOT ONE model call may be made from a 256px thumbnail");
  assert.ok(out.blocked_reason && out.blocked_reason.length > 40, "the reason must be shown in words, not a code");
  // Not one phrasing. What matters is that the person is told what to do, and
  // the wording moved from "Re-upload the file" to "Upload the file again".
  assert.ok(/upload the file again|re-?upload|describe it yourself|review it yourself/i.test(out.blocked_reason),
    "the reason must say what to do next");
});

test("15b. a clip with no frames at all also refuses rather than guessing", () => {
  const it = fakeIntake();
  const out = it.analyseOne({ id: "clip_b", thumbs: [] });
  assert.strictEqual(out.clip_status, "requires_human_review");
  assert.strictEqual(it.calls(), 0);
});

test("16. a blocked clip cannot be accepted while a flag is open", () => {
  const flags = [{ flag: "guest_face_identifiable", status: "unreviewed" }];
  assert.strictEqual(V.privacyBlocks(flags), true);
  flags[0].status = "cleared";
  assert.strictEqual(V.privacyBlocks(flags), false);
  flags[0].status = "release_required";
  assert.strictEqual(V.privacyBlocks(flags), true, "needing a release is not the same as being cleared");
});

/* ------------------------------------------------------------------------ */
const w = Math.max(...results.map((r) => r[1].length)) + 2;
console.log("\n  validation layer\n");
for (const [status, name, msg] of results) {
  const dot = status === "PASS" ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m";
  console.log(`  ${dot} ${name.padEnd(w)}${status === "FAIL" ? "\x1b[31m" + msg + "\x1b[0m" : ""}`);
}
console.log(`\n  ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
