import React, { useState, useEffect, useCallback, useRef } from "react";

/* ============================================================================
   Loading, failing, empty.

   Before Supabase every read was instant and could not fail, so a screen had
   two states: has data, or has none. It now has four, and the two new ones are
   the ones that lie if you leave them out.

   Nothing in here lets a screen render a list without having said which state
   it is in. `<DataState>` takes the Result and will not render its children
   until the read actually succeeded.
============================================================================ */

/* --------------------------------------------------------- reading -------- */

/**
 * One resource, four states.
 *
 * `stale` is what makes a refresh bearable: the previous rows stay on screen
 * while the next read is in flight, so a working list does not flash empty
 * every time something is saved.
 */
export function useResource(loader, deps = []) {
  const [state, setState] = useState({ status: "loading", data: null, failure: null, stale: false });
  const alive = useRef(true);
  const load = useCallback(async (opts = {}) => {
    setState((s) => s.data
      ? { ...s, status: "loading", stale: true }
      : { status: "loading", data: null, failure: null, stale: false });
    const r = await loader();
    if (!alive.current) return r;
    setState(r.ok
      ? { status: "ready", data: r.data, failure: null, stale: false, count: r.count }
      : { status: "failed", data: opts.keepData ? state.data : null, failure: r, stale: false });
    return r;
  }, deps);

  useEffect(() => { alive.current = true; load(); return () => { alive.current = false; }; }, [load]);
  return { ...state, reload: load };
}

/**
 * Gates its children on a Result.
 *
 * A refusal and an empty list get different renderings, always, because they
 * mean different things and a person acts differently on each.
 */
export function DataState({ state, empty, children, onRetry, label = "this" }) {
  if (state.status === "loading" && !state.stale) return <Loading label={label} />;
  if (state.status === "failed") return <Failure failure={state.failure} onRetry={onRetry ?? state.reload} />;
  const isEmpty = Array.isArray(state.data) && state.data.length === 0;
  if (isEmpty && empty) return empty;
  return (
    <div style={{ opacity: state.stale ? 0.55 : 1, transition: "opacity 120ms" }}>
      {children}
    </div>
  );
}

export function Loading({ label = "this", rows = 3 }) {
  return (
    <div role="status" aria-live="polite" className="py-2">
      <span className="sr-only">Loading {label}…</span>
      <div className="space-y-2" aria-hidden="true">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="rounded-xl border border-slate-200 bg-white"
            style={{ height: 72, opacity: 1 - i * 0.22 }} />
        ))}
      </div>
      <p className="text-sm text-slate-500 mt-3">Reading {label} from the database…</p>
    </div>
  );
}

/**
 * A failure a person can act on.
 *
 * Retry is only offered when retrying could plausibly work. A refusal is not
 * retryable, and putting a button there would be its own quiet lie: it would
 * imply the problem is transient when the problem is a missing rule.
 */
export function Failure({ failure, onRetry, compact }) {
  const [showRaw, setShowRaw] = useState(false);
  if (!failure) return null;
  return (
    <div role="alert" className="border rounded-xl p-4"
      style={{ borderColor: "var(--cc-rose-line, #FDA4AF)", background: "var(--cc-rose-bg, #FFF1F2)" }}>
      <p className="text-base font-semibold" style={{ color: "var(--cc-rose-text, #9F1239)" }}>
        {failure.title}
      </p>
      <p className="text-sm mt-1 leading-relaxed" style={{ color: "var(--cc-rose-text, #9F1239)" }}>
        {failure.detail}
      </p>

      {!compact && (
        <div className="flex items-center gap-2 mt-3 flex-wrap">
          {failure.retryable && onRetry && (
            <button onClick={onRetry}
              className="text-sm px-3 py-1.5 rounded-lg bg-white border border-slate-300 cursor-pointer">
              Try again
            </button>
          )}
          {failure.kind === "not_connected" && (
            <a href="#connect" className="text-sm px-3 py-1.5 rounded-lg bg-slate-900 text-white">
              Connect to a database
            </a>
          )}
          {failure.kind === "asleep" && (
            <a href="https://supabase.com/dashboard" target="_blank" rel="noreferrer"
              className="text-sm px-3 py-1.5 rounded-lg bg-white border border-slate-300">
              Open Supabase
            </a>
          )}
          {failure.raw && (
            <button onClick={() => setShowRaw(!showRaw)}
              className="text-sm text-slate-600 underline cursor-pointer">
              {showRaw ? "Hide" : "Show"} what the database said
            </button>
          )}
        </div>
      )}
      {showRaw && failure.raw && (
        <pre className="text-xs mt-2 p-2 rounded-lg bg-white overflow-auto"
          style={{ border: "0.5px solid #D6D3D1", maxHeight: 160 }}>{String(failure.raw)}</pre>
      )}
    </div>
  );
}

/* --------------------------------------------------------- writing -------- */

/**
 * A write, and the promise that nothing claims success early.
 *
 * `run` returns the Result. It sets `saving` while the request is out and only
 * calls onSaved once the server has handed the row back. Anything that wants
 * to update the screen does it from the returned row, not from what it sent.
 */
export function useSave() {
  const [state, setState] = useState({ saving: false, failure: null, savedAt: null });
  const run = useCallback(async (fn, { onSaved } = {}) => {
    setState({ saving: true, failure: null, savedAt: null });
    const r = await fn();
    if (r.ok) {
      setState({ saving: false, failure: null, savedAt: Date.now() });
      const row = Array.isArray(r.data) ? r.data[0] : r.data;
      onSaved?.(row, r);
    } else {
      setState({ saving: false, failure: r, savedAt: null });
    }
    return r;
  }, []);
  const clear = useCallback(() => setState({ saving: false, failure: null, savedAt: null }), []);
  return { ...state, run, clear };
}

/**
 * The button that cannot lie.
 *
 * It reads "Saving…" while the request is out, and it does not go back to its
 * normal label until the server has confirmed. On failure it shows why, right
 * where the person clicked, rather than somewhere else on the page.
 */
export function SaveButton({ save, onClick, children, savingLabel = "Saving…", className = "", disabled }) {
  return (
    <span className="inline-flex flex-col items-start gap-1.5">
      <button onClick={onClick} disabled={disabled || save.saving} className={className}
        aria-busy={save.saving || undefined}>
        {save.saving ? savingLabel : children}
      </button>
      {save.failure && (
        <span role="alert" className="text-xs leading-relaxed max-w-sm"
          style={{ color: "var(--cc-rose-text, #9F1239)" }}>
          <strong>Not saved.</strong> {save.failure.detail}
          {save.failure.retryable && " You can try again."}
        </span>
      )}
    </span>
  );
}

/**
 * A partial write: the parent landed, a child did not.
 *
 * This is the shape a half-saved collab or clip comes back in. It is neither a
 * success nor a plain failure, and flattening it into either would misinform:
 * the person needs to know something exists but is incomplete, and which half.
 */
export function PartialWarning({ result, onFix }) {
  if (!result?.partial) return null;
  const what = { shot_items: "its shot list", clip_privacy_flags: "its privacy flags" }[result.partial.missing]
    ?? result.partial.missing;
  return (
    <div role="alert" className="border rounded-xl p-4 mt-3"
      style={{ borderColor: "#FCD34D", background: "#FFFBEB" }}>
      <p className="text-base font-semibold" style={{ color: "#78350F" }}>Saved, but not all of it</p>
      <p className="text-sm mt-1 leading-relaxed" style={{ color: "#78350F" }}>
        The record was created, but {what} did not save. {result.detail} Until that is fixed,
        treat this record as incomplete rather than empty.
      </p>
      {onFix && (
        <button onClick={onFix} className="text-sm px-3 py-1.5 rounded-lg bg-white border border-slate-300 mt-3 cursor-pointer">
          Try saving the rest
        </button>
      )}
    </div>
  );
}
