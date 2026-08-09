/* Sending a clip to the library is two writes in a specific order. The order
   is the safety property, so it is worth a test rather than a comment. */
global.window = { localStorage: { getItem: () => null, setItem() {}, removeItem() {} } };
global.document = { createElement: () => ({ style: {}, setAttribute() {}, appendChild() {}, remove() {} }),
  head: { appendChild() {} }, documentElement: { setAttribute() {}, removeAttribute() {} } };

let pass = 0, bad = 0;
const is = (n, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log("  ok   " + n); }
  else { bad++; console.log(`  FAIL ${n}\n       got  ${JSON.stringify(got)}\n       want ${JSON.stringify(want)}`); }
};

/* The order that fails safely: the library row first. If the second write
   never lands you have footage you can see and a clip still undecided. The
   other order loses the footage. */
const order = [];
const libraryCreate = async (ok) => { order.push("library"); return { ok }; };
const clipPatch = async () => { order.push("clip"); return { ok: true }; };

async function send({ libraryOk }) {
  order.length = 0;
  const made = await libraryCreate(libraryOk);
  if (!made.ok) return { moved: false, order: [...order] };
  await clipPatch();
  return { moved: true, order: [...order] };
}

(async () => {
  let r = await send({ libraryOk: true });
  is("the library row is written first", r.order, ["library", "clip"]);
  is("both writes happen when the first succeeds", r.moved, true);

  r = await send({ libraryOk: false });
  is("a refused library write stops before the clip is marked", r.order, ["library"]);
  is("nothing is claimed as accepted", r.moved, false);

  console.log(`\n  ${pass} passed, ${bad} failed`);
  process.exit(bad ? 1 : 0);
})();
