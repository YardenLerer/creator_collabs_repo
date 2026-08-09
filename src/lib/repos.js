/* ============================================================================
   One repository per entity.

   Screens never build a query. They ask a repository for a thing and get back
   a Result they cannot render without deciding whether it succeeded.

   The mapping in here exists because two of the app's records are stored
   across more than one table. A collab carries its shot list in shot_items and
   its visit history in visit_proposals; a clip carries its privacy flags in
   clip_privacy_flags. That split was chosen so those rows can be counted and
   queried - and the cost of it is paid exactly here, once, instead of in
   twelve screens.
============================================================================ */

import { ok, insert, update, upsert, remove, request, loadAll } from "./db.js";

const list = (table, query = "select=*") => request(`${table}?${query}`);

/* ------------------------------------------------------------- gaps ------- */
export const gapsRepo = {
  all: () => list("gaps", "select=*&order=created_at.desc"),
  create: (gap) => insert("gaps", gap),
  patch: (id, p) => update("gaps", id, p),
  destroy: (id) => remove("gaps", id),
};

/* --------------------------------------------------------- creators ------- */
export const creatorsRepo = {
  all: () => list("creators", "select=*&order=display_name.asc"),
  create: (c) => insert("creators", c),
  patch: (id, p) => update("creators", id, p),
  destroy: (id) => remove("creators", id),
};

/* ---------------------------------------------------------- scores -------- */
/**
 * A score row, and only the columns that exist.
 *
 * The score object the screens carry is wider than the table: it picks up
 * working fields as it goes - the reason a read failed, the basis a model
 * gave, whatever the last run attached. Sending the whole object made
 * PostgREST refuse the write for one unknown column, and the message a person
 * saw was "The database rejected the data", which is true and useless.
 *
 * The repository owns the row shape. Anything not named here stays in memory
 * where it belongs.
 */
const SCORE_COLUMNS = [
  "id", "creator_id", "gap_id", "disqualified", "measured", "measured_score",
  "affinity", "ai_status", "total", "input_fingerprint", "taxonomy_version",
  "branch_fit", "format_fit", "audience_fit", "created_by",
];

const scoreRow = (s) => {
  const row = {};
  for (const k of SCORE_COLUMNS) if (s[k] !== undefined) row[k] = s[k];
  // Required and not null in the table, so a score that never ran still needs
  // to say so rather than arriving empty.
  row.ai_status ??= "not_run";
  row.disqualified ??= [];
  row.measured ??= {};
  row.taxonomy_version ??= 1;
  return row;
};

export const scoresRepo = {
  all: () => list("scores", "select=*"),
  save: (s) => upsert("scores", scoreRow(s), "creator_id,gap_id"),
};

/* --------------------------------------------------------- collabs -------- */
/**
 * A collab is one row plus two child tables. Postgrest can return all three in
 * one request, so the split costs a wider select rather than three round trips.
 */
const COLLAB_SELECT =
  "select=*,shot_items(*),visit_proposals(*)&order=created_at.desc";

const shapeCollab = (row) => ({
  ...row,
  brief_shot_list: (row.shot_items ?? []).sort((a, b) => a.position - b.position),
  visit_proposals: (row.visit_proposals ?? []).sort((a, b) => a.date.localeCompare(b.date)),
  shot_items: undefined,
});

export const collabsRepo = {
  async all() {
    const r = await list("collabs", COLLAB_SELECT);
    return r.ok ? ok(r.data.map(shapeCollab), r.count) : r;
  },
  async create(collab, shots = []) {
    const { brief_shot_list, visit_proposals, ...row } = collab;
    const made = await insert("collabs", row);
    if (!made.ok) return made;
    const saved = Array.isArray(made.data) ? made.data[0] : made.data;
    // A 200 with nothing in it means the row may exist but we do not know its
    // id, so there is nothing to hang the shot list on. That is a failure, not
    // a success with a missing piece.
    if (!saved?.id) {
      return { ok: false, kind: "bad_request", title: "The database took it but said nothing",
        detail: "The collab was accepted but no record came back, so its brief cannot be attached to it.",
        retryable: true };
    }
    if (shots.length === 0) return ok(shapeCollab({ ...saved, shot_items: [], visit_proposals: [] }));

    const withParent = shots.map((s, i) => ({ ...s, collab_id: saved.id, position: i }));
    const items = await insert("shot_items", withParent);
    // The collab exists but its brief does not. Saying "saved" here would be
    // the exact lie this layer is built to prevent, so the failure is returned
    // with the half that did land, and the screen says what to do about it.
    if (!items.ok) return { ...items, partial: { collab: saved, missing: "shot_items" } };
    return ok(shapeCollab({ ...saved, shot_items: items.data, visit_proposals: [] }));
  },
  patch: (id, p) => update("collabs", id, p),
  destroy: (id) => remove("collabs", id),
};

/* ------------------------------------------------------ shot items -------- */
export const shotsRepo = {
  create: (collabId, shot, position) => insert("shot_items", { ...shot, collab_id: collabId, position }),
  patch: (id, p) => update("shot_items", id, p),
  destroy: (id) => remove("shot_items", id),
  async replaceAll(collabId, shots) {
    const gone = await request(`shot_items?collab_id=eq.${encodeURIComponent(collabId)}`, { method: "DELETE" });
    if (!gone.ok) return gone;
    if (shots.length === 0) return ok([]);
    return insert("shot_items", shots.map((s, i) => ({ ...s, collab_id: collabId, position: i })));
  },
};

/* -------------------------------------------------- visit proposals ------- */
export const visitsRepo = {
  create: (collabId, proposal) => insert("visit_proposals", { ...proposal, collab_id: collabId }),
  patch: (id, p) => update("visit_proposals", id, p),
  /** Counts refusals by branch. The reason this is a table and not a field. */
  declinesByBranch: () =>
    request("visit_proposals?select=decline_reason,collabs(branch_id)&status=eq.declined"),
};

/* --------------------------------------------------------- clips ---------- */
const CLIP_SELECT = "select=*,clip_privacy_flags(*)&order=created_at.asc";

const shapeClip = (row) => ({
  ...row,
  // Never undefined. A screen that reads these arrays should not have to know
  // whether the row came from a table or a view.
  quality_flags: row.quality_flags ?? [],
  ai_issues: row.ai_issues ?? [],
  privacy_issues: row.privacy_issues ?? [],
  overconfidence: row.overconfidence ?? [],
  thumb_paths: row.thumb_paths ?? [],
  privacy_flags: row.clip_privacy_flags ?? [],
  clip_privacy_flags: undefined,
  // Frames live in storage now, so a reloaded clip has paths and no data URLs
  // until they are signed. Nothing may treat a missing URL as a missing frame.
  thumbs: row.thumbs ?? [],
});

export const clipsRepo = {
  async all() {
    const r = await list("clips", CLIP_SELECT);
    return r.ok ? ok(r.data.map(shapeClip), r.count) : r;
  },
  async forCollab(collabId) {
    const r = await list("clips", `${CLIP_SELECT}&collab_id=eq.${encodeURIComponent(collabId)}`);
    return r.ok ? ok(r.data.map(shapeClip), r.count) : r;
  },
  async create(clip, flags = []) {
    /* `thumbs` used to be stripped here, back when frames were session-only
       data URLs that had no business in a row. They are not any more: a clip
       whose frames come from a stock search has nothing in storage, and the
       column is the only place its pictures exist. Dropping it wrote every
       clip to the database with no frames at all, which is why the screens
       said "No frames" on reload while looking fine before it.

       Storage-backed clips still carry thumb_paths and are signed on read, so
       for those this column is simply empty. */
    const { privacy_flags, ...row } = clip;
    const made = await insert("clips", row);
    if (!made.ok) return made;
    const saved = Array.isArray(made.data) ? made.data[0] : made.data;
    if (!saved?.id) {
      return { ok: false, kind: "bad_request", title: "The database took it but said nothing",
        detail: "The clip was accepted but no record came back, so its privacy flags cannot be attached to it.",
        retryable: true };
    }
    if (flags.length === 0) return ok(shapeClip({ ...saved, clip_privacy_flags: [] }));
    const f = await insert("clip_privacy_flags", flags.map((x) => ({ ...x, clip_id: saved.id })));
    // A clip whose privacy flags failed to save would look clean while being
    // unreviewed. It is held blocked rather than shown as fine.
    if (!f.ok) return { ...f, partial: { clip: saved, missing: "clip_privacy_flags" } };
    return ok(shapeClip({ ...saved, clip_privacy_flags: f.data }));
  },
  patch: (id, p) => update("clips", id, p),
  destroy: (id) => remove("clips", id),
};

export const privacyRepo = {
  resolve: (flagId, patch) => update("clip_privacy_flags", flagId, patch),
  /** How many clips are blocked on an unreviewed flag, asked of the database. */
  blockedCount: () =>
    request("clip_privacy_flags?select=clip_id&status=in.(unreviewed,release_required)", {
      headers: { Prefer: "count=exact" },
    }),
};

/* -------------------------------------------------------- library --------- */
export const libraryRepo = {
  /**
   * The library is a view, and a view has no child rows: it returns no
   * privacy_flags column at all. Reading it raw handed the screens a row that
   * looked like a clip and was missing two arrays, and the first thing that
   * called .some() on one of them took the whole screen down.
   *
   * shapeClip is what every other read goes through. This one does too now.
   */
  async all() {
    const r = await list("library", "select=*&order=accepted_at.desc");
    return r.ok ? ok(r.data.map((row) => shapeClip({ ...row, clip_privacy_flags: [] })), r.count) : r;
  },
  /* Read only. It is a view over accepted clips joined to their collab, so a
     write goes to clips and shows up here on the next read. */
};

/* ---------------------------------------------------------- edits --------- */
/**
 * What editors are assembling out of the library.
 *
 * Read as two lists rather than one join: a failure to read the membership
 * rows should leave the edits themselves visible, with an honest gap in the
 * counts, instead of taking the whole section down.
 */
export const editsRepo = {
  all: () => list("edits", "select=*&order=due_at.asc.nullslast"),
  members: () => list("edit_clips", "select=*&order=position.asc"),
};

/* ------------------------------------------------------- settings --------- */
export const settingsRepo = {
  all: () => list("settings"),
  set: (key, value) => upsert("settings", { key, value }, "key"),
};

/* ------------------------------------------------------- activity --------- */
export const activityRepo = {
  recent: (n = 50) => list("activity_log", `select=*&order=created_at.desc&limit=${n}`),
  /**
   * Logging must never be the reason a real action fails. It is recorded on a
   * best-effort basis and its failure is returned rather than thrown, so a
   * caller can surface it if it cares and ignore it if it does not.
   */
  log: (actor, action, entity, entityId, detail) =>
    insert("activity_log", { actor, action, entity, entity_id: entityId, detail }),
};

/* ------------------------------------------------- whole-app load --------- */
/**
 * What a cold start needs. One call, five reads, and a per-read account of
 * what failed - so a refused clips table shows four working screens and one
 * honest explanation, not a blank app.
 */
export const loadEverything = () => loadAll({
  gaps: gapsRepo.all(),
  creators: creatorsRepo.all(),
  collabs: collabsRepo.all(),
  clips: clipsRepo.all(),
  scores: scoresRepo.all(),
  settings: settingsRepo.all(),
  library: libraryRepo.all(),
  edits: editsRepo.all(),
  editClips: editsRepo.members(),
});
