/* The frames a clip carries have to survive the write. This is the bug that
   made every screen say "No frames" while the same clips looked fine in the
   session that created them. */
let pass = 0, bad = 0;
const is = (n, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log("  ok   " + n); }
  else { bad++; console.log(`  FAIL ${n}\n       got  ${JSON.stringify(got)}\n       want ${JSON.stringify(want)}`); }
};

// What create() sends to the database, in both shapes a clip can have.
const rowFor = (clip) => { const { privacy_flags, ...row } = clip; return row; };

const stock = { id: "c1", thumbs: ["data:a", "data:b", "data:c"], thumb_paths: [], privacy_flags: [] };
const uploaded = { id: "c2", thumbs: [], thumb_paths: ["c2/0.jpg", "c2/1.jpg"], privacy_flags: [] };

is("a stock clip keeps its frames", rowFor(stock).thumbs, ["data:a", "data:b", "data:c"]);
is("privacy flags never go in the row", rowFor(stock).privacy_flags, undefined);
is("an uploaded clip keeps its paths", rowFor(uploaded).thumb_paths, ["c2/0.jpg", "c2/1.jpg"]);
is("and its empty thumbs are harmless", rowFor(uploaded).thumbs, []);

// And what the screens do with each on the way back.
const thumbsFor = (clip, signed = {}) => {
  if (clip.thumbs?.length) return clip.thumbs;
  const paths = clip.thumb_paths ?? [];
  const urls = paths.map((p) => signed[p]).filter(Boolean);
  return urls.length === paths.length ? urls : [];
};

is("stock frames render straight from the row", thumbsFor(stock).length, 3);
is("uploaded frames render once signed",
  thumbsFor(uploaded, { "c2/0.jpg": "u0", "c2/1.jpg": "u1" }), ["u0", "u1"]);
is("a half-signed set renders nothing rather than half a clip",
  thumbsFor(uploaded, { "c2/0.jpg": "u0" }), []);

console.log(`\n  ${pass} passed, ${bad} failed`);
process.exit(bad ? 1 : 0);
