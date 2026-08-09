/* The validation layer, re-exported from where it lives.
 *
 * It is defined inside App.jsx alongside the taxonomy it checks against, and
 * moving it wholesale would mean touching a thousand lines of working code
 * for no behavioural gain. This module exists so that tests and any future
 * caller have one import path, and so there is never a second copy to drift.
 *
 * If it is ever worth extracting properly, this is the seam to do it at:
 * nothing imports the functions from App.jsx directly.
 *
 * Note for anyone writing a test against these: Node cannot load App.jsx, so
 * import them from the bundle the test harness builds (test/out.cjs) rather
 * than from here. This module is for bundlers.
 */
export {
  TAXONOMY,
  ALL_TAXONOMY_VALUES,
  validateDescription,
  validatePrivacy,
  privacyBlocks,
  extractJson,
  canAnalyse,
  framePlan,
  matchClipToShots,
} from "../App.jsx";
