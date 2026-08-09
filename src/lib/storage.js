/* ============================================================================
   Files.

   Two buckets, both private. Videos go in one, the small frames in the other.

   The large frames do not go anywhere. They are made in the browser, sent to
   the model in one request, and dropped. That was true when this stored
   nothing and it stays true now that there is somewhere to put them, because
   the reason was never a lack of storage - it is that a 1024px frame of a
   guest in a treatment room is the most sensitive thing this system touches,
   and the safest place for it is nowhere.
============================================================================ */

import { getConnection } from "./config.js";

const VIDEOS = "clip-videos";
const THUMBS = "clip-thumbs";
const SIGNED_FOR = 3600; // one hour

const fail = (kind, title, detail, retryable = true) =>
  ({ ok: false, kind, title, detail, retryable });

async function storage(path, init = {}) {
  const conn = getConnection();
  if (!conn) return fail("not_connected", "Not connected yet",
    "This app has not been pointed at a database yet.", false);
  try {
    const res = await fetch(`${conn.url}/storage/v1/${path}`, {
      ...init,
      headers: { apikey: conn.key, Authorization: `Bearer ${conn.key}`, ...(init.headers ?? {}) },
    });
    if (res.ok) {
      const text = await res.text();
      return { ok: true, data: text ? JSON.parse(text) : null };
    }
    const body = (await res.text()).slice(0, 300);
    if (res.status === 401 || res.status === 403)
      return fail("refused", "Storage refused this",
        "The key was accepted but this bucket has no rule that allows it. A storage policy is missing - the file is not being hidden from you on purpose.", false);
    if (res.status === 404)
      return fail("not_found", "That file is not there",
        "The bucket or the file does not exist. If the clip is old, the original may have been deleted.", false);
    if (res.status === 413)
      return fail("too_large", "The file is too large",
        "This bucket accepts videos up to 500 MB. Ask her for a smaller export, or trim it first.", false);
    if (res.status === 415)
      return fail("wrong_type", "That file type is not accepted",
        "The bucket takes mp4, mov, webm and m4v.", false);
    return fail("unknown", "Storage errored", `The server answered with ${res.status}. ${body}`);
  } catch (e) {
    return fail("offline", "Storage could not be reached",
      "Either this computer is offline, or the project URL is wrong.");
  }
}

const safeName = (name) => name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-80);

/** The original file. Kept so frames can be pulled again at full size later. */
export async function uploadVideo(clipId, file, onProgress) {
  const path = `${clipId}/${safeName(file.name)}`;
  onProgress?.({ phase: "video", done: 0, total: 1 });
  const r = await storage(`object/${VIDEOS}/${path}`, {
    method: "POST",
    body: file,
    headers: { "Content-Type": file.type || "application/octet-stream", "x-upsert": "true" },
  });
  onProgress?.({ phase: "video", done: 1, total: 1 });
  return r.ok ? { ok: true, data: { bucket: VIDEOS, path } } : r;
}

/** The small frames. Stored so a person can tell clips apart after a reload. */
export async function uploadThumbs(clipId, dataUrls, onProgress) {
  const paths = [];
  for (let i = 0; i < dataUrls.length; i++) {
    onProgress?.({ phase: "thumbs", done: i, total: dataUrls.length });
    const blob = await (await fetch(dataUrls[i])).blob();
    const path = `${clipId}/${String(i).padStart(2, "0")}.jpg`;
    const r = await storage(`object/${THUMBS}/${path}`, {
      method: "POST", body: blob,
      headers: { "Content-Type": "image/jpeg", "x-upsert": "true" },
    });
    // A clip with some of its frames is worse than one that says it failed:
    // the strip would look complete and be wrong.
    if (!r.ok) return { ...r, partial: { uploaded: paths } };
    paths.push(path);
  }
  onProgress?.({ phase: "thumbs", done: dataUrls.length, total: dataUrls.length });
  return { ok: true, data: paths };
}

/**
 * Both buckets are private, so nothing is reachable without one of these.
 * Signing in a batch keeps a twelve-clip grid to one request instead of forty.
 */
export async function signThumbs(paths) {
  if (!paths?.length) return { ok: true, data: {} };
  const r = await storage(`object/sign/${THUMBS}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ expiresIn: SIGNED_FOR, paths }),
  });
  if (!r.ok) return r;
  const conn = getConnection();
  const map = {};
  for (const item of r.data ?? []) {
    if (item.signedURL) map[item.path] = `${conn.url}/storage/v1${item.signedURL}`;
  }
  return { ok: true, data: map, expiresAt: Date.now() + SIGNED_FOR * 1000 };
}

export async function signVideo(path) {
  const r = await storage(`object/sign/${VIDEOS}/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ expiresIn: SIGNED_FOR }),
  });
  if (!r.ok) return r;
  const conn = getConnection();
  return { ok: true, data: `${conn.url}/storage/v1${r.data.signedURL}` };
}

/**
 * Pulls the original back so frames can be extracted again at full size.
 *
 * This is what turns the old "thumbnails only, analysis refuses" dead end into
 * something recoverable: the original is still here, so full-size frames can be
 * made again.
 *
 * The gate itself does not go away. If the original was deleted, or this
 * download fails, analysis still refuses and still says why. The rule was never
 * "always have full frames" - it was "never analyse a degraded input without
 * saying so" - and that rule is now satisfied better, not weakened.
 */
export async function fetchOriginal(path, onProgress) {
  const signed = await signVideo(path);
  if (!signed.ok) return signed;
  try {
    const res = await fetch(signed.data);
    if (!res.ok) return fail("not_found", "The original could not be downloaded",
      `The storage server answered with ${res.status}.`, false);
    const total = Number(res.headers.get("content-length")) || 0;
    if (!res.body || !total) {
      const blob = await res.blob();
      return { ok: true, data: blob };
    }
    const reader = res.body.getReader();
    const chunks = [];
    let done_ = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      done_ += value.length;
      onProgress?.({ phase: "download", done: done_, total });
    }
    return { ok: true, data: new Blob(chunks) };
  } catch (e) {
    return fail("offline", "The original could not be downloaded",
      "The download was interrupted.");
  }
}

export async function deleteClipFiles(clipId, videoPath, thumbPaths = []) {
  const errors = [];
  if (videoPath) {
    const r = await storage(`object/${VIDEOS}`, {
      method: "DELETE", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prefixes: [videoPath] }),
    });
    if (!r.ok) errors.push(r);
  }
  if (thumbPaths.length) {
    const r = await storage(`object/${THUMBS}`, {
      method: "DELETE", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prefixes: thumbPaths }),
    });
    if (!r.ok) errors.push(r);
  }
  return errors.length ? { ...errors[0], detail: errors[0].detail + " The record was removed but its files may still be in storage." } : { ok: true, data: null };
}
