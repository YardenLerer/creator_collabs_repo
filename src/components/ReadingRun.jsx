import React, { useState, useEffect, useRef } from "react";

/* ============================================================================
   The one place the model's work is visible.

   Everywhere else the model is a field with a violet mark next to it, which is
   honest but invisible. Intake is where the jump actually is: thirty files
   called IMG_4471 go in, and what comes out is thirty sentences, a set of
   privacy flags, and a diff against the brief.

   This shows that jump as it happens - what went in, what has come out, and
   how long it took. It is not a progress bar with a percentage; it is the
   before and after, side by side, with the count moving.

   It has to read correctly at three clips as well as at thirty. A demo is
   usually four files, and a component that only feels right at scale would be
   dead exactly where it gets shown.
============================================================================ */

/** Ticks while a run is open. Stops on the last frame so the total is exact. */
function useElapsed(active, startedAt) {
  const [ms, setMs] = useState(0);
  useEffect(() => {
    if (!active || !startedAt) return;
    setMs(Date.now() - startedAt);
    const t = setInterval(() => setMs(Date.now() - startedAt), 100);
    return () => clearInterval(t);
  }, [active, startedAt]);
  return ms;
}

const secs = (ms) => {
  const s = ms / 1000;
  if (s < 10) return `${s.toFixed(1)}s`;
  if (s < 90) return `${Math.round(s)}s`;
  return `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;
};

/**
 * One row of the run: the filename it arrived as, and the sentence it became.
 *
 * The filename stays on screen after the sentence appears. That is the whole
 * point - "IMG_4471.mov" next to "Sauna, with nobody in frame" is the evidence
 * that something happened, and removing it would throw the comparison away.
 */
function RunRow({ clip, sentenceFor }) {
  const done = !!clip.ai?.room_type?.value;
  const failed = clip.clip_status === "analysis_failed" || clip.clip_status === "unreadable_file";
  const running = clip.clip_status === "analysing";
  return (
    <div className="flex items-baseline gap-3 py-1.5" style={{ borderBottom: "0.5px solid var(--cc-line)" }}>
      <span className="cc-mono text-xs text-slate-500 shrink-0" style={{ width: 130 }}>
        {clip.filename.length > 18 ? clip.filename.slice(0, 16) + "…" : clip.filename}
      </span>
      <span className="text-slate-300 shrink-0" aria-hidden="true">→</span>
      <span className="text-sm flex-1 min-w-0 leading-snug">
        {done ? <span className="text-slate-900">{sentenceFor(clip)}</span>
          : failed ? <span style={{ color: "var(--cc-amber)" }}>could not be read</span>
          : running ? <span className="text-slate-400">reading…</span>
          : <span className="text-slate-300">waiting</span>}
      </span>
    </div>
  );
}

export default function ReadingRun({ clips, active, startedAt, finishedAt, sentenceFor, onDismiss }) {
  const elapsed = useElapsed(active, startedAt);
  const total = clips.length;
  const read = clips.filter((c) => c.ai?.room_type?.value).length;
  const flagged = clips.filter((c) => (c.privacy_flags ?? []).length > 0).length;
  const matched = clips.filter((c) => c.match?.level === "full").length;
  const took = finishedAt && startedAt ? finishedAt - startedAt : elapsed;

  if (!total) return null;
  const finished = !active && read > 0;

  return (
    <section className="border border-slate-200 rounded-xl bg-white px-5 py-4 mb-4"
      aria-live="polite" aria-atomic="false">
      <div className="flex items-baseline gap-2.5 flex-wrap">
        <Spark active={active} />
        <h2 className="text-lg font-medium text-slate-900">
          {active
            ? <>Reading <span className="cc-num">{read}</span> of <span className="cc-num">{total}</span></>
            : <><span className="cc-num">{read}</span> clip{read === 1 ? "" : "s"} read in <span className="cc-num">{secs(took)}</span></>}
        </h2>
        <span className="flex-1" />
        {finished && onDismiss && (
          <button onClick={onDismiss} className="text-sm text-slate-500 hover:text-slate-900 cursor-pointer">Hide</button>
        )}
      </div>

      <p className="text-sm text-slate-600 mt-1 leading-relaxed">
        {active
          ? <>Each clip goes out as frames and comes back as a sentence, a set of privacy flags, and a comparison against the brief. <span className="cc-num">{secs(elapsed)}</span> so far.</>
          : <>They arrived as filenames. Every line below is what a person can now read instead
            {flagged > 0 && <>, and <span className="cc-num">{flagged}</span> {flagged === 1 ? "is" : "are"} held for a privacy decision</>}.</>}
      </p>

      {(read > 0 || active) && (
        <div className="mt-3.5 mb-1" style={{ maxHeight: 260, overflowY: "auto" }}>
          {clips.map((c) => <RunRow key={c.id} clip={c} sentenceFor={sentenceFor} />)}
        </div>
      )}

      {finished && (
        <div className="flex items-center gap-5 flex-wrap mt-3 pt-3 border-t border-slate-100 text-sm text-slate-600">
          <span><span className="cc-num text-slate-900">{matched}</span> match the brief</span>
          <span><span className="cc-num text-slate-900">{flagged}</span> waiting on a privacy call</span>
          <span><span className="cc-num text-slate-900">{total - read}</span> could not be read</span>
        </div>
      )}
    </section>
  );
}

/** The only animated thing on the screen, and it stops the moment work does. */
function Spark({ active }) {
  return (
    <span className="inline-flex items-center justify-center rounded-full shrink-0"
      style={{ width: 22, height: 22, background: "var(--cc-violet-tint)" }} aria-hidden="true">
      <span style={{
        width: 7, height: 7, borderRadius: 99, background: "var(--cc-violet)",
        animation: active ? "cc-pulse 1.1s ease-in-out infinite" : "none",
      }} />
    </span>
  );
}
