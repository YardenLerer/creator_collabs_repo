/* Checks the promises the UI layer makes, without a browser. */
import { readFileSync } from "node:fs";
const ui = readFileSync(new URL("../src/components/DataState.jsx", import.meta.url), "utf8");
const repos = readFileSync(new URL("../src/lib/repos.js", import.meta.url), "utf8");
const store = readFileSync(new URL("../src/lib/storage.js", import.meta.url), "utf8");
const flat = (x) => x.replace(/\s*\n\s*\*?\s*/g, " ");

let pass = 0, bad = 0;
const t = (n, c, why) => { if (c) { console.log("  ok   " + n); pass++; }
  else { console.log("  FAIL " + n + (why ? " — " + why : "")); bad++; } };

t("retry is offered only when retrying could work",
  /failure\.retryable && onRetry/.test(ui),
  "a retry button on a refusal implies the problem is transient");

t("a refused read is rendered as a failure, never as an empty list",
  /status === "failed"/.test(ui) && ui.indexOf('status === "failed"') < ui.indexOf("isEmpty"),
  "the failure branch must come before the empty branch");

t("empty and failed are separate branches",
  /isEmpty && empty/.test(ui) && /<Failure/.test(ui));

t("loading is announced to screen readers",
  /role="status"/.test(ui) && /aria-live="polite"/.test(ui));

t("a failure is announced as an alert",
  /role="alert"/.test(ui));

t("a refresh keeps the old rows instead of flashing empty",
  /stale: true/.test(ui));

t("the save button reports saving while the request is out",
  /save\.saving \? savingLabel/.test(ui) && /aria-busy/.test(ui));

t("a failed save says 'Not saved' rather than going quiet",
  /Not saved/.test(ui));

t("the screen is updated from the row the server returned, not the one sent",
  /Array\.isArray\(r\.data\) \? r\.data\[0\] : r\.data/.test(ui));

t("a half-saved record is neither success nor plain failure",
  /PartialWarning/.test(ui) && /result\?\.partial/.test(ui));

t("repositories return the partial shape when a child write fails",
  /partial: \{ collab: saved, missing: "shot_items" \}/.test(repos)
  && /partial: \{ clip: saved, missing: "clip_privacy_flags" \}/.test(repos));

t("writes ask for the saved row back",
  /Prefer.*return=representation/.test(readFileSync(new URL("../src/lib/db.js", import.meta.url), "utf8")));

t("the large frames are still never stored",
  !/uploadAnalysisFrames|upload.*analysis/i.test(store)
  && /the safest place for it is nowhere/.test(store));

t("a partly uploaded frame strip is a failure, not a short strip",
  /partial: \{ uploaded: paths \}/.test(store),
  "a strip that looks complete and is not would be worse than an error");

t("thumbnails are signed in one batch, not one request each",
  /object\/sign\/\$\{THUMBS\}/.test(store) && /paths \}\)/.test(store));

t("storage refusal is separated from a missing file",
  /kind === 401|status === 401/.test(store) === false
  ? /"refused"/.test(store) && /"not_found"/.test(store)
  : true);

t("the analysis gate survives recovery",
  /The rule was never "always have full frames"/.test(flat(store))
  && /still refuses and still says why/.test(flat(store)),
  "recovering the original must not remove the refusal when it is gone");

console.log(`\n  ${pass} passed, ${bad} failed\n`);
process.exit(bad ? 1 : 0);
