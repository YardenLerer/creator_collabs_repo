/* ============================================================================
   Keeping a list on screen and a table in the database in step.

   Every screen in this app says `setGaps(nextArray)`. That worked when saving
   was instant and could not fail. It now has to become inserts, updates and
   deletes that each take time and can each be refused - and the screens should
   not have to know that.

   So the setter keeps its shape and this file does the work: diff the array it
   was handed against the one before it, issue only what actually changed, and
   wait for the server.

   On failure the previous array is put back. That is the honest ending. The
   alternative - leaving the new rows on screen after the write was refused -
   would mean the screen is showing something the database does not have, which
   is the same quiet lie as reporting a refusal as an empty list.
============================================================================ */

import { ok } from "./db.js";

const byId = (rows) => new Map((rows ?? []).map((r) => [r.id, r]));

/** Compares only what is stored, so a re-render does not look like an edit. */
const differs = (a, b, ignore = ["updated_at", "created_at"]) => {
  const strip = (o) => {
    const c = { ...o };
    for (const k of ignore) delete c[k];
    return c;
  };
  return JSON.stringify(strip(a)) !== JSON.stringify(strip(b));
};

export function diffRows(prev, next) {
  const p = byId(prev), n = byId(next);
  const added = [], changed = [], removed = [];
  for (const [id, row] of n) {
    if (!p.has(id)) added.push(row);
    else if (differs(p.get(id), row)) changed.push(row);
  }
  for (const id of p.keys()) if (!n.has(id)) removed.push(id);
  return { added, changed, removed };
}

/**
 * Applies a diff and reports every failure rather than the first.
 *
 * If three rows save and one is refused, the caller needs to know which one.
 * Stopping at the first failure would leave the rest unattempted and the
 * screen unable to say what state anything is in.
 */
export async function applyDiff(repo, { added, changed, removed }, prepare = (r) => r) {
  const failures = [];
  const saved = [];

  for (const row of added) {
    const r = await repo.create(prepare(row));
    if (r.ok) saved.push(Array.isArray(r.data) ? r.data[0] : r.data);
    else failures.push({ ...r, what: "creating", id: row.id });
  }
  for (const row of changed) {
    const { id, ...patch } = prepare(row);
    const r = await repo.patch(id, patch);
    if (r.ok) saved.push(Array.isArray(r.data) ? r.data[0] : r.data);
    else failures.push({ ...r, what: "updating", id });
  }
  for (const id of removed) {
    const r = await repo.destroy(id);
    if (!r.ok) failures.push({ ...r, what: "deleting", id });
  }

  if (failures.length === 0) return ok(saved);
  const f = failures[0];
  return {
    ...f,
    detail: failures.length === 1
      ? `${f.detail} This happened while ${f.what} one record.`
      : `${f.detail} ${failures.length} records could not be saved.`,
    failures,
  };
}

/* --------------------------------------------------------- collabs -------- */
/**
 * A collab spans three tables, so its diff spans three too. The shot list and
 * the visit proposals are child rows, and a change to either is a change to
 * the collab as far as any screen is concerned.
 */
export async function syncCollabs(prev, next, { collabsRepo, shotsRepo, visitsRepo }) {
  const strip = (c) => {
    const { brief_shot_list, visit_proposals, shot_items, ...row } = c;
    return row;
  };
  const p = byId(prev), n = byId(next);
  const failures = [];

  for (const [id, c] of n) {
    const before = p.get(id);

    if (!before) {
      const r = await collabsRepo.create(strip(c), c.brief_shot_list ?? []);
      if (!r.ok) failures.push({ ...r, what: "creating a collab", id });
      // Proposals on a brand new collab are rare but possible via the example.
      for (const v of c.visit_proposals ?? []) {
        const rv = await visitsRepo.create(id, v);
        if (!rv.ok) failures.push({ ...rv, what: "saving a proposed date", id: v.id });
      }
      continue;
    }

    if (differs(strip(before), strip(c))) {
      const { id: _, ...patch } = strip(c);
      const r = await collabsRepo.patch(id, patch);
      if (!r.ok) failures.push({ ...r, what: "updating a collab", id });
    }

    const shots = diffRows(before.brief_shot_list, c.brief_shot_list);
    if (shots.added.length || shots.changed.length || shots.removed.length) {
      const r = await shotsRepo.replaceAll(id, c.brief_shot_list ?? []);
      if (!r.ok) failures.push({ ...r, what: "saving the shot list", id });
    }

    const visits = diffRows(before.visit_proposals, c.visit_proposals);
    for (const v of visits.added) {
      const r = await visitsRepo.create(id, v);
      if (!r.ok) failures.push({ ...r, what: "saving a proposed date", id: v.id });
    }
    for (const v of visits.changed) {
      const { id: vid, collab_id, ...patch } = v;
      const r = await visitsRepo.patch(vid, patch);
      if (!r.ok) failures.push({ ...r, what: "answering a proposed date", id: vid });
    }
    // Proposals are never deleted. A date that was asked for and turned down is
    // the record, and removing it would erase the pattern the branch screen
    // exists to show.
  }

  for (const id of p.keys()) {
    if (!n.has(id)) {
      const r = await collabsRepo.destroy(id);
      if (!r.ok) failures.push({ ...r, what: "deleting a collab", id });
    }
  }

  if (failures.length === 0) return ok(next);
  const f = failures[0];
  return { ...f, detail: `${f.detail} This happened while ${f.what}.`, failures };
}

/* ----------------------------------------------------------- scores ------- */
/** Scores are held as an object keyed by creator and gap, not as an array. */
export async function syncScores(prev, next, scoresRepo) {
  const failures = [];
  for (const [key, score] of Object.entries(next)) {
    if (prev[key] && !differs(prev[key], score)) continue;
    const r = await scoresRepo.save(score);
    if (!r.ok) failures.push({ ...r, what: "saving a score", id: key });
  }
  if (failures.length === 0) return ok(next);
  const f = failures[0];
  return { ...f, detail: `${f.detail} This happened while ${f.what}.`, failures };
}
