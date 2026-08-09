/* ============================================================================
   Every read and write goes through here.

   The rule this file exists to enforce:

     A read that returns nothing must say whether it FOUND nothing or was
     REFUSED, and a write must not be reported as saved until the server says
     it saved.

   Those are the same failure the whole product is built against. A screen that
   says "no gaps yet" when it means "you are not allowed to see the gaps" is
   lying quietly, exactly like a model that answers "morning" about a room with
   no window. Postgrest makes this easy to get wrong: a missing row policy
   returns 200 with an empty array, which is indistinguishable from an empty
   table unless you go looking.

   So nothing here returns a bare array. Everything returns a Result, and the
   caller cannot render it without deciding which case it is in.
============================================================================ */

import { getConnection } from "./config.js";

/** @typedef {{ok: true, data: any, count?: number}} Success */
/** @typedef {{ok: false, kind: string, title: string, detail: string, retryable: boolean, raw?: any}} Failure */

export const ok = (data, count) => ({ ok: true, data, count });

/**
 * Failure kinds, and what each one means to the person looking at the screen.
 * These are enums for the same reason decline reasons are: a failure you
 * cannot count is a failure you cannot fix.
 */
export const FAILURE = {
  not_connected:  { title: "Not connected yet", retryable: false },
  offline:        { title: "No connection",     retryable: true  },
  refused:        { title: "The database refused this", retryable: false },
  not_found:      { title: "That table does not exist", retryable: false },
  asleep:         { title: "The database is asleep",    retryable: true  },
  rate_limited:   { title: "Too many requests",  retryable: true  },
  server_error:   { title: "The database errored", retryable: true },
  bad_request:    { title: "The database rejected the data", retryable: false },
  conflict:       { title: "Something else changed this first", retryable: false },
  timeout:        { title: "It took too long",   retryable: true  },
  unknown:        { title: "Something went wrong", retryable: true },
};

const fail = (kind, detail, raw) => ({
  ok: false,
  kind,
  title: FAILURE[kind]?.title ?? FAILURE.unknown.title,
  detail,
  retryable: FAILURE[kind]?.retryable ?? true,
  raw,
});

/**
 * Turns an HTTP response into a failure a person can act on.
 *
 * 401 and 403 are the important ones. They are what a missing policy looks
 * like, and they must never be flattened into "no results".
 */
async function failureFromResponse(res) {
  let body = "";
  try { body = await res.text(); } catch { /* body may be empty */ }
  const short = body.slice(0, 400);

  if (res.status === 401 || res.status === 403) {
    return fail("refused",
      "The key was accepted but this table is not readable with it. That usually means a row level security policy is missing, not that the table is empty. "
      + "Nothing is being hidden from you on purpose - the database simply has no rule that lets this through.", short);
  }
  if (res.status === 404) {
    return fail("not_found",
      "The database has no table by that name. The app and the database are out of step with each other.", short);
  }
  if (res.status === 409) {
    return fail("conflict",
      "A record with the same identity already exists, or something else changed it while you were working.", short);
  }
  if (res.status === 400 || res.status === 422) {
    return fail("bad_request",
      "The database would not accept this. The message it gave back is below.", short);
  }
  if (res.status === 429) {
    return fail("rate_limited", "Too many requests went out at once. Wait a moment and try again.", short);
  }
  if (res.status === 503 || res.status === 502 || res.status === 504) {
    return fail("asleep",
      "The database did not answer. Supabase pauses projects that go untouched for a while - open the project in the Supabase dashboard and resume it, then try again.", short);
  }
  if (res.status >= 500) {
    return fail("server_error", "The database returned an error. This is not something you did.", short);
  }
  return fail("unknown", `The database answered with ${res.status}.`, short);
}

const TIMEOUT_MS = 20000;

/**
 * One request. Returns a Result and never throws.
 */
export async function request(path, { method = "GET", body, headers = {}, signal } = {}) {
  const conn = getConnection();
  if (!conn) {
    return fail("not_connected",
      "This app has not been pointed at a database yet. Open the connect screen and paste the project URL and key.");
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort("timeout"), TIMEOUT_MS);
  signal?.addEventListener("abort", () => ctrl.abort(signal.reason), { once: true });

  try {
    const res = await fetch(`${conn.url}/rest/v1/${path}`, {
      method,
      signal: ctrl.signal,
      headers: {
        apikey: conn.key,
        Authorization: `Bearer ${conn.key}`,
        "Content-Type": "application/json",
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    if (!res.ok) return await failureFromResponse(res);

    // 204 is a successful write with nothing to return.
    if (res.status === 204) return ok(null);

    const text = await res.text();
    const data = text ? JSON.parse(text) : null;
    const range = res.headers.get("content-range");
    const count = range && range.includes("/") ? Number(range.split("/")[1]) : undefined;
    return ok(data, Number.isFinite(count) ? count : undefined);
  } catch (e) {
    if (e?.name === "AbortError" || ctrl.signal.reason === "timeout") {
      return fail("timeout", "The database did not answer within twenty seconds.");
    }
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      return fail("offline", "This computer is not online.");
    }
    return fail("offline",
      "The database could not be reached. Either this computer is offline, or the project URL is wrong.", String(e?.message ?? e));
  } finally {
    clearTimeout(timer);
  }
}

/* ------------------------------------------------------------ verbs ------- */

export const selectAll = (table, query = "select=*") =>
  request(`${table}?${query}`, { headers: { Prefer: "count=exact" } });

/**
 * Writes ask for the row back. That is the whole point: until the server hands
 * back the saved record, nothing on screen may claim it saved. The returned
 * row - not the one we sent - is what goes into state, so defaults filled in
 * by the database are what the person sees.
 */
export const insert = (table, row) =>
  request(table, { method: "POST", body: row, headers: { Prefer: "return=representation" } });

export const upsert = (table, row, onConflict = "id") =>
  request(`${table}?on_conflict=${onConflict}`, {
    method: "POST", body: row,
    headers: { Prefer: "resolution=merge-duplicates,return=representation" },
  });

export const update = (table, id, patch) =>
  request(`${table}?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH", body: patch, headers: { Prefer: "return=representation" },
  });

/**
 * Deleting one row.
 *
 * It asks for the deleted row back, and treats an empty result as a refusal.
 *
 * Under row-level security a delete the policy does not permit is not an
 * error: PostgREST reports success and removes nothing. Every other write in
 * this file already refuses to claim more than the server confirmed, and this
 * one used to be the exception - it would report "deleted" for a row still
 * sitting in the table.
 */
export const remove = async (table, id) => {
  const r = await request(`${table}?id=eq.${encodeURIComponent(id)}&select=id`,
    { method: "DELETE", headers: { Prefer: "return=representation" } });
  if (!r.ok) return r;
  const rows = Array.isArray(r.data) ? r.data : [];
  if (rows.length === 0) {
    return fail("refused",
      "The database accepted the request and removed nothing, which is what a "
      + "delete looks like when the row-level policy does not allow it. "
      + "Nothing was deleted.");
  }
  return r;
};

/**
 * Runs several reads together and keeps every failure separate.
 *
 * Loading a screen means loading four or five things. If one is refused and
 * the rest succeed, the person needs to see the four and be told plainly which
 * one is missing and why - not a blank page, and not four lists silently
 * missing a fifth.
 */
export async function loadAll(jobs) {
  const names = Object.keys(jobs);
  const results = await Promise.all(names.map((n) => jobs[n]));
  const data = {}, failures = {};
  names.forEach((n, i) => {
    const r = results[i];
    if (r.ok) data[n] = r.data;
    else { data[n] = null; failures[n] = r; }
  });
  return { data, failures, anyFailed: Object.keys(failures).length > 0 };
}
