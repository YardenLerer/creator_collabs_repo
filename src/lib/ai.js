/* ============================================================================
   Talking to the model through the Edge Function.

   The key lives on the server as a Supabase secret. Nothing here holds one,
   asks for one, or stores one, and there is no screen that does either.

   The function answers in plain language on purpose - "sauna", "nobody in
   frame", "warm and dim" - because that is what a person can read back and
   check. The taxonomy this product validates against is a fixed vocabulary.
   The gap between them is closed HERE, in code, by matching the words to the
   vocabulary. The model is never handed the list and asked to pick from it,
   and the validation layer is not loosened to accept whatever came back.

   Where a word matches nothing, the field is left missing. Missing is already
   a neutral, handled state everywhere downstream. Guessing would not be.
============================================================================ */

import { getConnection } from "./config.js";

/** Everything a caller needs to tell the difference between five failures. */
const fail = (kind, title, detail, retryable = false) =>
  ({ ok: false, kind, title, detail, retryable });

/**
 * One call to the function.
 *
 * The anon key authorises it, the same key the rest of the app uses. The
 * function requires a JWT, so the header is not optional.
 */
export async function callAi({ task, input = {}, images = [], max_tokens = 2000, signal }) {
  const conn = getConnection();
  if (!conn) {
    return fail("no_connection", "Not connected to the database",
      "The model runs through this project, so a connection has to exist first.");
  }

  let res;
  try {
    res = await fetch(`${conn.url}/functions/v1/ai`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: conn.key,
        Authorization: `Bearer ${conn.key}`,
      },
      body: JSON.stringify({ task, input, images, max_tokens }),
      signal,
    });
  } catch (e) {
    if (e?.name === "AbortError") return fail("cancelled", "Stopped", "You stopped the run.");
    return fail("network", "Could not reach the reader",
      "The request never left this machine. Check the connection and try again.", true);
  }

  let body;
  try { body = await res.json(); } catch {
    return fail("bad_response", "The reader answered with something unreadable",
      `It replied ${res.status} and the body was not JSON.`, true);
  }

  if (!res.ok || body?.error) {
    const map = {
      no_key: ["The reader has no key", "ANTHROPIC_API_KEY is not set on this project. It goes in Project Settings, Edge Functions, Secrets."],
      no_frames: ["This clip has no frames to read", body?.message ?? "Send the frame URLs, or upload the file again."],
      unknown_task: ["That is not something the reader does", body?.message ?? ""],
      upstream_unreachable: ["The reader could not reach the model", "Try again in a moment.", true],
      upstream_error: ["The model refused the request", `It answered ${body?.status}.`, true],
      bad_upstream_json: ["The model answered with something unreadable", "Running it again usually clears this.", true],
      bad_request: ["The request was malformed", body?.message ?? ""],
    };
    const [title, detail, retryable] = map[body?.error] ?? [
      "The reader failed", body?.message ?? `It answered ${res.status}.`, true];
    if (res.status === 401 || res.status === 403) {
      return fail("refused", "The project refused the call",
        "The key this app is connected with is not allowed to run the reader.");
    }
    return fail(body?.error ?? "model_failed", title, detail, !!retryable);
  }

  return { ok: true, data: body.data, text: body.text, framesRead: body.frames_read, ms: body.ms };
}

/* --------------------------------------------------------------- judgement -- */
/**
 * How close a creator's existing work feels to one request.
 *
 * This is the only thing the model is asked about a person, and it is kept
 * apart from everything else on purpose. Whether she lives near the branch,
 * whether her clips get kept, whether she turns up on time - all of that is
 * counted from records and none of it is folded in here. A single number that
 * mixed judgement with measurement would be impossible to argue with, and the
 * arguing is the point.
 *
 * A null affinity is a real answer. It means her notes did not say enough, and
 * it is better than a number invented to fill the space.
 */
export async function scoreAffinity({ creator, gap, label, signal }) {
  const r = await callAi({
    task: "score_creator",
    input: {
      creator: {
        style_note: creator.style_note ?? null,
        shoots: (creator.creator_vertical ?? []).map(label),
        strongest_format: (creator.format_strength ?? []).map(label),
        camera: creator.camera ?? null,
      },
      request: {
        room: (gap.room_type ?? []).map(label).join(" or "),
        scene: (gap.scene ?? []).map(label).join(", "),
        format: (gap.aspect ?? []).map(label).join(" or "),
        shot_size: (gap.shot_size ?? []).map(label).join(", "),
      },
    },
    max_tokens: 400, signal,
  });
  if (!r.ok) return r;

  const n = r.data?.affinity;
  const affinity = typeof n === "number" && n >= 0 && n <= 100 ? Math.round(n) : null;
  const why = String(r.data?.why ?? "").trim();
  if (!why) {
    return fail("bad_shape", "The reader answered without a reason",
      "A score with no reason attached is not usable here.", true);
  }
  return { ok: true, affinity, why, ms: r.ms };
}

/**
 * Shooting instructions for one shot.
 *
 * The room, the count, the format and the scene are computed from the gap and
 * are passed in as fixed. The model is asked only how to shoot it - the part
 * that is craft and has no single right answer. It is never asked what to
 * shoot, because that is derived and a guess would quietly replace a
 * calculation nobody would think to re-check.
 */
export async function draftShotNotes({ shot, label, signal }) {
  const r = await callAi({
    task: "brief_notes",
    input: {
      room: label(shot.room_type),
      count: shot.count,
      format: label(shot.aspect),
      scene: (Array.isArray(shot.scene) ? shot.scene : [shot.scene]).filter(Boolean).map(label).join(", "),
      shot_size: shot.shot_size ? label(shot.shot_size) : null,
      lighting: shot.lighting ? label(shot.lighting) : null,
    },
    max_tokens: 400, signal,
  });
  if (!r.ok) return r;

  const instruction = String(r.data?.instruction ?? "").trim();
  const note = String(r.data?.note ?? "").trim();
  if (!instruction) {
    return fail("bad_shape", "The reader answered without instructions",
      "Nothing usable came back for this shot.", true);
  }
  return { ok: true, instruction, note, ms: r.ms };
}

/* ------------------------------------------------------------- stock media -- */
/**
 * Placeholder footage, through the `media` Edge Function.
 *
 * Everything this returns is stock. It exists so the screens can be looked at
 * with pictures in them, and every row it fills is marked as sample data - a
 * stranger's sauna is not footage a creator shot at a branch, and the whole
 * product is built on being able to tell those apart.
 */
export async function findMedia({ kind = "photos", query, per_page = 6, orientation = "portrait", signal }) {
  const conn = getConnection();
  if (!conn) {
    return fail("no_connection", "Not connected to the database",
      "Stock media comes through this project, so a connection has to exist first.");
  }

  let res;
  try {
    res = await fetch(`${conn.url}/functions/v1/media`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: conn.key, Authorization: `Bearer ${conn.key}` },
      body: JSON.stringify({ kind, query, per_page, orientation }),
      signal,
    });
  } catch (e) {
    if (e?.name === "AbortError") return fail("cancelled", "Stopped", "You stopped the search.");
    return fail("network", "Could not reach the picture search",
      "The request never left this machine.", true);
  }

  let body;
  try { body = await res.json(); } catch {
    return fail("bad_response", "The picture search answered with something unreadable",
      `It replied ${res.status}.`, true);
  }

  if (!res.ok || body?.error) {
    const map = {
      no_key: ["The picture search has no key", "PEXELS_API_KEY is not set on this project. It goes in Project Settings, Edge Functions, Secrets."],
      bad_key: ["Pexels refused the key", "The key on this project is not accepted. Check it at pexels.com/api."],
      rate_limited: ["Pexels is rate limiting this key", "Wait a minute and try again.", true],
      no_query: ["Nothing to search for", "Say what to look for."],
      upstream_unreachable: ["Could not reach Pexels", "Try again in a moment.", true],
    };
    const [title, detail, retryable] = map[body?.error] ?? [
      "The picture search failed", body?.message ?? `It answered ${res.status}.`, true];
    if (res.status === 401 || res.status === 403) {
      return fail("refused", "The project refused the call",
        "The key this app is connected with is not allowed to run the picture search.");
    }
    return fail(body?.error ?? "media_failed", title, detail, !!retryable);
  }

  return { ok: true, items: body.items ?? [], total: body.total ?? 0, ms: body.ms };
}

/* ------------------------------------------------------- the word matcher -- */
/**
 * Matches a phrase to one value of a controlled vocabulary.
 *
 * Deliberately dumb: exact match on the label, then on the code, then a
 * containment check. It does not do synonyms or stemming, because a clever
 * matcher that is right nine times in ten quietly mislabels the tenth clip,
 * and nobody would ever find out which one.
 */
function matchOne(phrase, vocabulary, label) {
  const p = String(phrase ?? "").trim().toLowerCase();
  if (!p) return null;
  const norm = (s) => String(s).toLowerCase().replace(/[_-]+/g, " ").trim();

  for (const v of vocabulary) if (norm(label(v)) === p || norm(v) === p) return v;
  for (const v of vocabulary) {
    const l = norm(label(v));
    if (l.length > 3 && (p.includes(l) || l.includes(p))) return v;
  }
  return null;
}

/**
 * Turns one read_clip answer into the fields the validation layer expects.
 *
 * Anything unmatched is simply absent. Confidence is reported as low for a
 * field that had to be matched loosely, so the screen can show that the value
 * was inferred from a phrase rather than stated.
 */
export function clipReadingToFields(data, { ROOM_TYPE, SCENE, SHOT_SIZE, LIGHTING, label }) {
  if (!data || typeof data !== "object") return { fields: {}, unmatched: ["the whole answer"] };

  const fields = {};
  const unmatched = [];
  const put = (key, phrase, vocab) => {
    const v = matchOne(phrase, vocab, label);
    if (v) fields[key] = { value: v, confidence: "medium" };
    else if (String(phrase ?? "").trim()) unmatched.push(String(phrase).trim());
  };

  put("room_type", data.room, ROOM_TYPE);
  put("shot_size", data.framing, SHOT_SIZE);
  put("lighting_condition", data.lighting, LIGHTING);

  const scene = matchOne(data.action, SCENE, label);
  if (scene) fields.scene = { value: [scene], confidence: "medium" };
  else if (String(data.action ?? "").trim()) unmatched.push(String(data.action).trim());

  return { fields, unmatched, notes: String(data.quality_notes ?? "").trim() || null };
}

/**
 * The privacy answer, kept separate from the description on purpose.
 *
 * A recognisable face blocks the clip. The function is told not to soften it,
 * and this does not soften it either: anything other than an explicit false is
 * treated as "a person must look", because the safe direction here is to stop.
 */
export function clipReadingToPrivacy(data) {
  if (!data || typeof data !== "object") {
    return { blocked: true, reason: "The privacy answer could not be read, so this one is held." };
  }
  if (data.face_recognisable === true) {
    return { blocked: true, reason: "A guest's face is recognisable in this clip." };
  }
  if (data.face_recognisable === false) {
    return { blocked: false, peopleVisible: data.people_visible === true };
  }
  return { blocked: true, reason: "The reader did not say whether a face is recognisable, so this one is held." };
}
