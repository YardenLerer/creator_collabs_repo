import React, { useState, useMemo } from "react";
import { Button, Chip, Field, Section, SingleSelect, Modal, Drawer } from "./Primitives.jsx";

/* ============================================================================
   Gaps, Creators, and the two things that hang off them.

   Rewritten after an automated edit cut them out of the file. They follow the
   language the rebuilt screens settled on: one card shape, headings that read
   as instructions, states as a dot and a word, and no colour that is not a
   token.
============================================================================ */

const RING = "0 0 0 0.5px var(--hairline), 0 1px 2px rgba(28,25,23,0.03)";
const CARD = { background: "var(--surface)", borderRadius: 16, boxShadow: RING };
const H2 = { margin: 0, fontSize: 18, fontWeight: 500, letterSpacing: "-0.015em" };
const SUB = { marginTop: 4, fontSize: 13, color: "var(--text-body)" };

/* ------------------------------------------------------------------ gaps -- */

/**
 * One gap.
 *
 * The slot strip is the point: one fixed cell per clip the gap asked for,
 * filled with a frame when a clip has closed it and empty when it has not.
 * Six empty boxes and two filled ones says "two of six" without a number, and
 * says it from across the room.
 */
export function GapCard({ gap, clips = [], thumbUrls = {}, thumbsFor, label, branchById,
  gapSentence, onOpen, showTechnical }) {
  const mine = clips.filter((c) => c.gap_id_closed === gap.id);
  const want = gap.quantity_needed ?? 0;
  const filled = Math.min(mine.length, want);
  const closed = gap.status === "closed";

  const due = gap.due_date
    ? Math.round((new Date(gap.due_date) - new Date()) / 86400000) : null;
  const dueWord = due === null ? "No deadline"
    : due < 0 ? `${Math.abs(due)} days late` : due === 0 ? "Due today" : `Due in ${due} days`;

  return (
    <article className="cc-lift" style={{ ...CARD, overflow: "hidden", opacity: closed ? 0.7 : 1 }}>
      <button onClick={onOpen} style={{ background: "none", border: 0, padding: 16, cursor: "pointer",
        textAlign: "left", width: "100%", display: "flex", flexDirection: "column", gap: 12 }}>

        <span style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12,
          color: "var(--text-meta)" }}>
          <span aria-hidden="true" style={{ width: 5, height: 5, borderRadius: 999, flex: "none",
            background: gap.priority === "p0" ? "var(--blocked)"
              : gap.priority === "p1" ? "var(--warn)" : "var(--hairline-2)" }} />
          {String(gap.priority ?? "p2").toUpperCase()}
          <span aria-hidden="true">·</span>
          {closed ? "Closed" : mine.length > 0 ? "Someone is on it" : "Nobody booked"}
        </span>

        {/* One cell per clip asked for. Fixed width, never flexed - a strip
            that stretches to fill the card stops meaning a count. */}
        <span style={{ display: "flex", gap: 3, overflow: "hidden" }}>
          {Array.from({ length: Math.min(want, 8) }, (_, i) => {
            const clip = mine[i];
            const frame = clip ? thumbsFor(clip, thumbUrls)[0] : null;
            return (
              <span key={i} aria-hidden="true"
                style={{ width: 36, height: 45, flex: "none", borderRadius: 6,
                  background: "var(--hairline) center/cover no-repeat",
                  backgroundImage: frame ? `url(${frame})` : "none",
                  boxShadow: i < filled ? "none" : "inset 0 0 0 1px var(--hairline-2)" }} />
            );
          })}
        </span>

        <span style={{ display: "block", fontSize: 15, fontWeight: 500, lineHeight: 1.4,
          letterSpacing: "-0.008em" }}>
          {gapSentence(gap)}
        </span>

        <span style={{ display: "block", fontSize: 12, color: "var(--text-meta)", lineHeight: 1.5 }}>
          {(gap.branch_id ?? []).map((b) => branchById(b)?.name).filter(Boolean).join(" or ") || "Any branch"}
          <span style={{ display: "block", marginTop: 2 }}>
            {dueWord} · <span className="cc-num">{filled} of {want}</span> in hand
          </span>
        </span>
      </button>
      {showTechnical && (
        <div style={{ padding: "0 16px 12px", fontSize: 11, color: "var(--text-meta)" }}>{gap.id}</div>
      )}
    </article>
  );
}

/** The gap in the words the taxonomy uses, one value per line. */
export function SpecLine({ gap, label }) {
  const parts = [
    ["Room", (gap.room_type ?? []).map(label).join(" or ")],
    ["What happens", (gap.scene ?? []).map(label).join(", ")],
    ["Format", (gap.aspect ?? []).map(label).join(" or ")],
    ["Shot size", (gap.shot_size ?? []).map(label).join(", ")],
    ["Lighting", (gap.lighting ?? []).map(label).join(", ")],
  ].filter(([, v]) => v);
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
      gap: "12px 20px" }}>
      {parts.map(([k, v]) => (
        <div key={k}>
          <div style={{ fontSize: 12, color: "var(--text-meta)" }}>{k}</div>
          <div style={{ marginTop: 3, fontSize: 14 }}>{v}</div>
        </div>
      ))}
    </div>
  );
}

/**
 * Scenes, in the order they matter.
 *
 * The first one is what the clip has to show; the rest are also useful. Order
 * is the whole meaning here, so it is chosen by moving items rather than by
 * ticking boxes and hoping the order is remembered.
 */
export function RankedSceneSelect({ value = [], onChange, options, label }) {
  const rest = options.filter((o) => !value.includes(o));
  return (
    <div>
      {value.length > 0 && (
        <ol style={{ margin: "0 0 10px", padding: 0, listStyle: "none",
          display: "flex", flexDirection: "column", gap: 7 }}>
          {value.map((v, i) => (
            <li key={v} style={{ display: "flex", alignItems: "center", gap: 9, fontSize: 14 }}>
              <span className="cc-num" style={{ width: 18, flex: "none", color: "var(--text-meta)",
                fontSize: 12 }}>{i + 1}</span>
              <span style={{ flex: 1, minWidth: 0 }}>
                {label(v)}
                {i === 0 && (
                  <span style={{ marginLeft: 8, fontSize: 12, color: "var(--text-meta)" }}>
                    must show this
                  </span>
                )}
              </span>
              {i > 0 && (
                <Button size="sm" variant="ghost" aria-label={`Move ${label(v)} up`}
                  onClick={() => {
                    const n = [...value]; [n[i - 1], n[i]] = [n[i], n[i - 1]]; onChange(n);
                  }}>Up</Button>
              )}
              <Button size="sm" variant="ghost" aria-label={`Remove ${label(v)}`}
                onClick={() => onChange(value.filter((x) => x !== v))}>Remove</Button>
            </li>
          ))}
        </ol>
      )}
      <SingleSelect options={rest} value="" labelFn={label} placeholder="Add a scene…"
        onChange={(v) => v && onChange([...value, v])} />
    </div>
  );
}

/** Footage we're missing. */
export function GapsScreen({ gaps, setGaps, clips = [], creators = [], scores = {}, collabs = [],
  onGo, focus, onClearFocus, showTechnical, onOpenMatching, onNewGap, thumbUrls = {},
  thumbsFor, label, branchById, gapSentence, ScreenIntro, EmptyState, NextStep }) {
  const [shelf, setShelf] = useState("open");

  const shown = gaps.filter((g) => shelf === "all" ? true
    : shelf === "closed" ? g.status === "closed" : g.status === "open");

  const open = gaps.filter((g) => g.status === "open");
  const needed = open.reduce((n, g) => n + g.quantity_needed, 0);
  const inHand = clips.filter((c) => c.gap_id_closed && c.clip_status === "accepted").length;
  const dueSoon = open.filter((g) => g.due_date
    && (new Date(g.due_date) - new Date()) / 86400000 <= 7);

  const booked = (g) => collabs.some((c) => (c.gap_ids ?? []).includes(g.id));
  const groups = [
    ["Due inside a week", shown.filter((g) => dueSoon.includes(g))],
    ["Nobody is booked to shoot these", shown.filter((g) => !dueSoon.includes(g) && !booked(g))],
    ["Someone is on these", shown.filter((g) => !dueSoon.includes(g) && booked(g))],
  ].filter(([, list]) => list.length > 0);

  return (
    <div style={{ maxWidth: 1180 }}>
      <ScreenIntro eyebrow="Stage 1" title="Footage we're missing" onHome={() => onGo("home")}
        action={<Button variant="primary" size="lg" onClick={() => onNewGap()}>Write a gap</Button>}
        stats={[
          { k: "Open", v: open.length },
          { k: "Due this week", v: dueSoon.length, tone: "rose" },
          { k: "Clips needed", v: needed },
          { k: "In hand", v: inHand },
        ]} />

      <div style={{ display: "flex", gap: 6, background: "var(--surface)", borderRadius: 12,
        padding: 4, boxShadow: "0 0 0 0.5px var(--hairline)", marginBottom: 22, width: "fit-content" }}>
        {[["open", "Open"], ["closed", "Closed"], ["all", "All"]].map(([k, name]) => (
          <button key={k} onClick={() => setShelf(k)}
            style={{ fontSize: 13, fontWeight: shelf === k ? 500 : 400, border: 0, cursor: "pointer",
              color: shelf === k ? "var(--on-dark)" : "var(--text-body)",
              background: shelf === k ? "var(--text)" : "transparent",
              borderRadius: 9, padding: "7px 15px" }}>{name}</button>
        ))}
      </div>

      {shown.length === 0 ? (
        <EmptyState skeleton="cards" title="Nothing written down yet"
          body="A gap is one sentence about footage that does not exist: which room, what happens in it, how many clips."
          then="Writing one is what lets you pick somebody to shoot it."
          action={<Button variant="primary" onClick={() => onNewGap()}>Write the first gap</Button>} />
      ) : groups.map(([heading, list]) => (
        <section key={heading} style={{ marginBottom: 26 }}>
          <h2 style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: "0.09em",
            color: "var(--text-meta)", marginBottom: 12 }}>
            {heading} <span className="cc-num">{list.length}</span>
          </h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
            gap: 16 }}>
            {list.map((g) => (
              <GapCard key={g.id} gap={g} clips={clips} thumbUrls={thumbUrls} thumbsFor={thumbsFor}
                label={label} branchById={branchById} gapSentence={gapSentence}
                showTechnical={showTechnical} onOpen={() => onOpenMatching?.(g.id)} />
            ))}
          </div>
        </section>
      ))}

      <NextStep onGo={() => onGo("creators")} goLabel="Go to Creators">
        Once a gap exists, stage 2 is where you pick who shoots it.
      </NextStep>
    </div>
  );
}

/* -------------------------------------------------------------- creators -- */

/** Who could shoot it. */
export function CreatorsScreen({ creators, setCreators, gaps, scores = {}, setScores,
  focusGapId, setFocusGapId, tab, setTab, onStartCollab, onGo, showTechnical,
  collabs = [], clips = [], thumbUrls = {}, onOpenCollab, identity, onScoreCreator,
  ScreenIntro, EmptyState, NextStep, CreatorCard, CreatorProfile, creatorRecord,
  Avatar, Thumb, thumbsFor, label, branchById, clipSentence, Speciality, Recommendation }) {
  const [openId, setOpenId] = useState(null);
  // Every hook this component uses is declared here, before the early return
  // that swaps the roster for one profile. React counts hooks per render, so a
  // useState below that return runs on one path and not the other.
  const [scoring, setScoring] = useState(null);
  const [scoreFailure, setScoreFailure] = useState(null);
  const open = openId ? creators.find((c) => c.id === openId) : null;

  if (open) {
    return (
      <CreatorProfile creator={open} record={creatorRecord(open, { collabs, clips, gaps })}
        gaps={gaps} identity={identity} onBack={() => setOpenId(null)}
        onEdit={() => {}} onStartCollab={() => onStartCollab({ creator: open, gap: null, score: null })}
        onOpenCollab={onOpenCollab} showTechnical={showTechnical}
        onAddNote={(note) => setCreators(creators.map((c) => c.id === open.id
          ? { ...c, notes: [...(c.notes ?? []), note] } : c))}
        Avatar={Avatar} Speciality={Speciality} Recommendation={Recommendation} Thumb={Thumb}
        thumbsFor={thumbsFor} thumbUrls={thumbUrls} label={label} branchById={branchById}
        clipSentence={clipSentence} Button={Button} />
    );
  }

  const scored = Object.keys(scores).length;

  /**
   * Scoring the roster against the open gaps.
   *
   * Two halves that never merge. The measured half - branch, format, audience -
   * is arithmetic on records and needs no model. The affinity half is a
   * judgement about whether her work feels like the footage asked for, and
   * that is the only thing the model is asked.
   *
   * They are stored side by side and shown side by side. A single blended
   * number would be impossible to argue with, and arguing with it is the point.
   */
  const runScoring = async () => {
    const open = gaps.filter((g) => g.status === "open");
    if (!open.length || !creators.length) return;
    setScoreFailure(null);
    setScoring({ done: 0, total: creators.length });

    const next = { ...scores };
    for (let i = 0; i < creators.length; i++) {
      const c = creators[i];
      setScoring({ done: i, total: creators.length, who: c.display_name });
      const r = await onScoreCreator?.(c, open);
      if (r?.failed) { setScoreFailure(r); break; }
      for (const [gapId, patch] of Object.entries(r?.byGap ?? {})) {
        const key = `${c.id}|${gapId}`;
        next[key] = { ...(next[key] ?? { creator_id: c.id, gap_id: gapId }), ...patch };
      }
    }
    setScores(next);
    setScoring(null);
  };

  return (
    <div style={{ maxWidth: 1180 }}>
      <ScreenIntro eyebrow="Stage 2" title="Who could shoot it" onHome={() => onGo("home")}
        stats={[{ k: "On the roster", v: creators.length }, { k: "Pairs scored", v: scored }]} />

      {onScoreCreator && creators.length > 0 && gaps.some((g) => g.status === "open") && (
        <section style={{ background: "var(--model-tint)", borderRadius: 16, padding: 18,
          marginBottom: 22, boxShadow: "inset 0 0 0 0.5px var(--model-ring)",
          display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
          <svg width="17" height="17" viewBox="0 0 24 24" fill="var(--model-text)" aria-hidden="true"
            style={{ flex: "none" }}>
            <path d="M12 2l2.2 6.3L20.5 10l-6.3 2.2L12 18.5 9.8 12.2 3.5 10l6.3-1.7z" />
          </svg>
          <div style={{ flex: "1 1 320px", minWidth: 0 }}>
            <p style={{ margin: 0, fontSize: 14, fontWeight: 500, color: "var(--model-text)" }}>
              {scored > 0
                ? `${scored} creator and gap pairs have been scored`
                : "Nobody has been scored against these gaps yet"}
            </p>
            <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--model-text)", opacity: 0.85,
              lineHeight: 1.5 }}>
              Branch, format and audience are counted from records. Only how close her work feels to
              the request is judged, and it is kept separate. Scoring is optional.
            </p>
          </div>
          <Button variant="violet" disabled={!!scoring} onClick={runScoring} style={{ flex: "none" }}>
            {scoring ? `Scoring ${scoring.who ?? ""}… ${scoring.done} of ${scoring.total}` : "Score the roster"}
          </Button>
        </section>
      )}

      {scoreFailure && (
        <div role="alert" style={{ background: "var(--blocked-tint)", borderRadius: 12,
          padding: "13px 15px", marginBottom: 22, boxShadow: "inset 3px 0 0 var(--blocked)" }}>
          <p style={{ margin: 0, fontSize: 14, fontWeight: 500, color: "var(--blocked-text)" }}>
            {scoreFailure.title ?? "Scoring stopped"}
          </p>
          <p style={{ margin: "3px 0 0", fontSize: 13, color: "var(--blocked-text)", lineHeight: 1.5 }}>
            {scoreFailure.detail}
          </p>
        </div>
      )}

      {creators.length === 0 ? (
        <EmptyState skeleton="cards" title="Nobody on the roster yet"
          body="Add the people you already work with. What she shoots and which branch she is near are the fields that matter."
          then="Picking a creator creates a draft brief in stage 3."
          action={<Button variant="primary" onClick={() => onGo("gaps")}>Write a gap first</Button>} />
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
          gap: 16 }}>
          {creators.map((c) => (
            <CreatorCard key={c.id} creator={c} record={creatorRecord(c, { collabs, clips, gaps })}
              onOpen={() => setOpenId(c.id)} thumbUrls={thumbUrls} showTechnical={showTechnical}
              thumbsFor={thumbsFor} label={label} branchById={branchById}
              Avatar={Avatar} Speciality={Speciality} Recommendation={Recommendation}
              onStartCollab={() => onStartCollab({ creator: c, gap: null, score: null })} />
          ))}
        </div>
      )}

      <NextStep onGo={() => onGo("briefs")} goLabel="Go to Briefs">
        Starting a collab creates a draft brief. That is where the rights get typed in.
      </NextStep>
    </div>
  );
}

/**
 * Starting a collab.
 *
 * A collab is a creator, a branch, and the gaps one visit should close. The
 * branch is asked for rather than assumed, because a creator near one branch
 * is often shooting at another and guessing it wrong sends somebody to the
 * wrong city.
 */
export function StartCollabDrawer({ open, onClose, creator, originGap, originScore, gaps,
  onCreate, identity, label, branchById, BRANCHES, gapSentence }) {
  const [branch, setBranch] = useState(originGap?.branch_id?.[0] ?? creator?.nearest_branch_id ?? null);
  const [picked, setPicked] = useState(originGap ? [originGap.id] : []);

  const eligible = gaps.filter((g) => g.status === "open"
    && (!branch || (g.branch_id ?? []).length === 0 || g.branch_id.includes(branch)));

  return (
    <Drawer open={open} onClose={onClose}
      title={`Start a collab with ${creator?.display_name ?? "a creator"}`}
      subtitle="One creator, one branch, and the gaps a single visit should close."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!branch || picked.length === 0}
            onClick={() => onCreate({ creator, branch_id: branch, gap_ids: picked,
              score: originScore ?? null, by: identity })}>
            Create the draft brief
          </Button>
        </>
      }>
      <Field label="Which branch is she visiting?" required
        hint={creator?.nearest_branch_id ? `Nearest to her: ${branchById(creator.nearest_branch_id)?.name}` : null}>
        <SingleSelect options={BRANCHES.map((b) => ({ value: b.id, label: b.name }))}
          value={branch} onChange={setBranch} placeholder="Pick a branch" />
      </Field>

      <Field label="Which gaps should this visit close?" required
        hint={picked.length ? `${picked.length} chosen` : null}>
        {eligible.length === 0 ? (
          <p style={{ margin: 0, fontSize: 13, color: "var(--text-meta)" }}>
            No open gap applies to that branch. Write one first, or pick another branch.
          </p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
            {eligible.map((g) => {
              const on = picked.includes(g.id);
              return (
                <button key={g.id}
                  onClick={() => setPicked(on ? picked.filter((x) => x !== g.id) : [...picked, g.id])}
                  aria-pressed={on}
                  style={{ display: "flex", alignItems: "flex-start", gap: 10, textAlign: "left",
                    border: 0, cursor: "pointer", borderRadius: 12, padding: "11px 13px",
                    background: on ? "var(--accent-tint)" : "var(--page)",
                    boxShadow: on ? "inset 0 0 0 1px var(--accent)" : "inset 0 0 0 0.5px var(--hairline)" }}>
                  <span aria-hidden="true" style={{ width: 5, height: 5, borderRadius: 999, flex: "none",
                    marginTop: 6, background: on ? "var(--accent)" : "var(--hairline-2)" }} />
                  <span style={{ flex: 1, minWidth: 0, fontSize: 14, lineHeight: 1.45 }}>
                    {gapSentence(g)}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </Field>

      <p style={{ margin: 0, fontSize: 12, color: "var(--text-meta)", lineHeight: 1.55 }}>
        Signed as {identity}. The shot list is computed from the gaps you pick, so nothing is
        written by hand and nothing is guessed.
      </p>
    </Drawer>
  );
}
