import React, { useState } from "react";
import { Button } from "./Primitives.jsx";

/* ============================================================================
   Visits and Briefs, rebuilt from the Claude Design handoff, plus the sidebar
   the phone uses.

   Both screens answer a question in the order a coordinator actually asks it:
   what is stuck, what is coming, and - the one nothing else in the product
   surfaces - who came and sent nothing back.
============================================================================ */

const RING = "0 0 0 0.5px var(--hairline), 0 1px 2px rgba(28,25,23,0.03)";
const CARD = { background: "var(--surface)", borderRadius: 16, boxShadow: RING };
const H2 = { margin: 0, fontSize: 18, fontWeight: 500, letterSpacing: "-0.015em" };
const SUB = { marginTop: 4, fontSize: 13, color: "var(--text-body)" };

/** A picture from data. Always a background, never a bound src. */
function Frame({ src, alt, size, height, radius }) {
  return (
    <span role={alt ? "img" : undefined} aria-label={alt || undefined}
      aria-hidden={alt ? undefined : "true"}
      style={{ width: size, height: height ?? size, flex: "none", borderRadius: radius,
        display: "block", background: "var(--hairline) center/cover no-repeat",
        backgroundImage: src ? `url(${src})` : "none" }} />
  );
}

/* ---------------------------------------------------------------- visits -- */

export function VisitsScreen({ collabs, setCollabs, gaps, creators, clips = [], identity,
  onGo, focus, onClearFocus, label, branchById, fmtDate, acceptedProposal, now,
  ProposeDate, NextStep, TIME_OF_DAY, VISIT_DURATION }) {
  const [proposing, setProposing] = useState(null);

  const today = new Date(); today.setHours(0, 0, 0, 0);
  const DAY = 86400000;
  const asDate = (d) => { const x = new Date(`${d}T00:00:00`); x.setHours(0, 0, 0, 0); return x; };
  const daysFrom = (d) => Math.round((asDate(d) - today) / DAY);

  const rows = collabs.flatMap((c) => (c.visit_proposals ?? []).map((p) => ({
    ...p, collab: c,
    creator: creators.find((x) => x.id === c.creator_id),
    branch: branchById(c.branch_id),
    clips: clips.filter((k) => k.collab_id === c.id),
    away: daysFrom(p.date),
  })));

  const waiting = rows.filter((r) => r.status === "pending" || r.status === "proposed");
  const upcoming = rows.filter((r) => r.status === "accepted" && r.away >= 0)
    .sort((a, b) => a.away - b.away);
  const owing = rows.filter((r) => r.status === "accepted" && r.away < 0 && r.clips.length === 0)
    .sort((a, b) => a.away - b.away);

  /* Fourteen cells. A solid dot is a date a branch confirmed; a hollow ring is
     one nobody has answered. The difference has to read without stopping,
     because the whole point of a rail is the glance. */
  const days = Array.from({ length: 14 }, (_, i) => {
    const d = new Date(today.getTime() + i * DAY);
    const iso = d.toISOString().slice(0, 10);
    const here = rows.filter((r) => r.date === iso);
    return {
      dow: ["S", "M", "T", "W", "T", "F", "S"][d.getDay()],
      num: d.getDate(), isToday: i === 0,
      has: here.length > 0,
      confirmed: here.some((r) => r.status === "accepted"),
      title: here.map((r) => `${r.creator?.display_name} at ${r.branch?.name}`).join(", ") || null,
    };
  });

  const askedFor = (c) => {
    const list = c.brief_shot_list ?? [];
    if (!list.length) return "Nothing written down yet";
    return list.map((sh) => `${sh.count} of the ${label(sh.room_type).toLowerCase()}`).join(", ");
  };
  const awayWord = (n) => n === 0 ? "Today" : n === 1 ? "Tomorrow"
    : n > 0 ? `In ${n} days` : `${Math.abs(n)} days ago`;

  const Row = ({ r, state, action, primary, onAction }) => (
    <div className="cc-lift" style={{ ...CARD, padding: 16, display: "flex", alignItems: "center",
      gap: 18, flexWrap: "wrap" }}>
      <Frame src={r.creator?.photo} alt={r.creator?.display_name} size={60} radius={13} />
      <div style={{ flex: "1 1 190px", minWidth: 0 }}>
        <div style={{ fontSize: 16, fontWeight: 500, letterSpacing: "-0.012em" }}>
          {r.creator?.display_name ?? "Creator not on the roster"}
        </div>
        <div style={{ marginTop: 3, fontSize: 13, color: "var(--text-meta)" }}>
          {r.creator?.handle}{r.branch ? ` · ${r.branch.name}` : ""}
        </div>
      </div>
      <div style={{ flex: "1 1 150px", minWidth: 0 }}>
        <div className="cc-num" style={{ fontSize: 15 }}>{fmtDate(r.date)}</div>
        <div style={{ marginTop: 3, fontSize: 13, color: "var(--text-meta)" }}>
          {r.away < 0 ? awayWord(r.away) : label(r.time_of_day)}
        </div>
      </div>
      <div style={{ flex: "1 1 190px", minWidth: 0, fontSize: 13, color: "var(--text-body)",
        lineHeight: 1.5 }}>{askedFor(r.collab)}</div>
      <div style={{ flex: "1 1 170px", minWidth: 0, display: "inline-flex", alignItems: "center",
        gap: 8, fontSize: 13, color: "var(--warn-text)" }}>
        <span aria-hidden="true" style={{ width: 5, height: 5, borderRadius: 999, flex: "none",
          background: "var(--warn)" }} />
        {state}
      </div>
      <Button size="sm" variant={primary ? "primary" : "outline"} onClick={onAction}
        style={{ flex: "none" }}>{action}</Button>
    </div>
  );

  return (
    <div style={{ maxWidth: 1180, display: "flex", flexDirection: "column", gap: 26 }}>
      {proposing && ProposeDate && (
        <ProposeDate collab={proposing} identity={identity} label={label}
          TIME_OF_DAY={TIME_OF_DAY} DURATION={VISIT_DURATION} now={now}
          onClose={() => setProposing(null)}
          onSave={(p) => {
            setCollabs(collabs.map((c) => c.id === proposing.id
              ? { ...c, visit_proposals: [...(c.visit_proposals ?? []), p], updated_at: now() } : c));
            setProposing(null);
          }} />
      )}

      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between",
        gap: 20, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 32, lineHeight: 1.1, letterSpacing: "-0.03em",
            fontWeight: 500 }}>Who's coming, and who owes us footage</h1>
          <div style={{ marginTop: 9, fontSize: 14, color: "var(--text-body)" }}>
            <span className="cc-num">{upcoming.length}</span> on the books
            {waiting.length > 0 && <> · <span className="cc-num">{waiting.length}</span> waiting on a branch</>}
            {owing.length > 0 && <> · <span className="cc-num">{owing.length}</span> came and sent nothing</>}
          </div>
        </div>
        <Button variant="primary" size="lg" style={{ flex: "none" }}
          onClick={() => {
            const c = collabs.find((x) => x.brief_approved_by && !acceptedProposal(x));
            if (c) setProposing(c); else onGo("briefs");
          }}>Book a visit</Button>
      </div>

      <section style={{ ...CARD, borderRadius: 18, padding: "18px 20px" }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between",
          gap: 12, marginBottom: 14, flexWrap: "wrap" }}>
          <span style={{ fontSize: 13, fontWeight: 500 }}>The next two weeks</span>
          <span style={{ fontSize: 12, color: "var(--text-meta)" }}>
            Hollow ring means the branch has not confirmed
          </span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(14, 1fr)", gap: 6 }}>
          {days.map((d, i) => (
            <div key={i} title={d.title ?? undefined}
              style={{ borderRadius: 10, padding: "9px 0 10px", textAlign: "center",
                background: d.isToday ? "var(--text)" : "var(--page)",
                color: d.isToday ? "var(--on-dark)" : "var(--text-body)" }}>
              <div style={{ fontSize: 11, opacity: 0.72 }}>{d.dow}</div>
              <div className="cc-num" style={{ marginTop: 3, fontSize: 15 }}>{d.num}</div>
              <div style={{ height: 9, marginTop: 6, display: "flex", alignItems: "center",
                justifyContent: "center" }}>
                {d.has && (
                  <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: 999,
                    display: "block",
                    background: d.confirmed ? "var(--accent)" : "transparent",
                    boxShadow: d.confirmed ? "none" : "inset 0 0 0 1.5px var(--warn)" }} />
                )}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section>
        <div style={{ marginBottom: 13 }}>
          <h2 style={H2}>Nobody has confirmed these dates</h2>
          <div style={SUB}>The creator accepted. The branch has not said yes yet.</div>
        </div>
        {waiting.length === 0 ? (
          <p style={{ margin: 0, fontSize: 14, color: "var(--text-meta)" }}>
            Every date you have asked for has an answer.
          </p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {waiting.map((r) => (
              <Row key={r.id} r={r} action="Chase the branch"
                state={`Asked ${fmtDate(String(r.proposed_at).slice(0, 10))}`}
                onAction={() => onGo("briefs", { collabId: r.collab.id })} />
            ))}
          </div>
        )}
      </section>

      <section>
        <div style={{ marginBottom: 13 }}>
          <h2 style={H2}>Confirmed and coming up</h2>
          <div style={SUB}>Everything is agreed. The host is expecting her.</div>
        </div>
        {upcoming.length === 0 ? (
          <p style={{ margin: 0, fontSize: 14, color: "var(--text-meta)" }}>Nothing is booked.</p>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(330px, 1fr))",
            gap: 16 }}>
            {upcoming.map((r) => {
              const refs = r.clips.slice(0, 3).map((c) => (c.thumbs ?? [])[0]);
              return (
                <article key={r.id} className="cc-lift"
                  style={{ ...CARD, overflow: "hidden", display: "flex", flexDirection: "column" }}>
                  {/* The row height is pinned. With only a height the implicit
                      row is auto-sized and the images paint over the card. */}
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr",
                    gridTemplateRows: "104px", height: 104, gap: 2, overflow: "hidden",
                    background: "var(--hairline)" }}>
                    {[0, 1, 2].map((i) => (
                      <span key={i} aria-hidden="true" style={{ display: "block", minHeight: 0,
                        background: "var(--hairline) center/cover no-repeat",
                        backgroundImage: refs[i] ? `url(${refs[i]})` : "none" }} />
                    ))}
                  </div>
                  <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 14 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
                      <Frame src={r.creator?.photo} alt={r.creator?.display_name} size={38} radius={999} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 15, fontWeight: 500, letterSpacing: "-0.01em",
                          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {r.creator?.display_name}
                        </div>
                        <div style={{ marginTop: 2, fontSize: 12, color: "var(--text-meta)" }}>
                          {r.branch?.name}
                        </div>
                      </div>
                      <span style={{ flex: "none", fontSize: 12, color: "var(--accent)",
                        background: "var(--accent-tint)", borderRadius: 8, padding: "4px 9px" }}>
                        {awayWord(r.away)}
                      </span>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
                      {[["When", `${fmtDate(r.date)}, ${label(r.time_of_day).toLowerCase()}`],
                        ["How long", label(r.duration)],
                        ["She's bringing back", askedFor(r.collab)]].map(([k, v]) => (
                        <div key={k} style={{ display: "flex", justifyContent: "space-between",
                          gap: 12, fontSize: 13 }}>
                          <span style={{ color: "var(--text-meta)", flex: "none" }}>{k}</span>
                          <span className={k === "When" ? "cc-num" : undefined}
                            style={{ textAlign: "right", minWidth: 0 }}>{v}</span>
                        </div>
                      ))}
                    </div>
                    <div style={{ paddingTop: 13, boxShadow: "inset 0 0.5px 0 var(--hairline)",
                      display: "flex", alignItems: "center", gap: 9 }}>
                      <Button size="sm" variant="outline" style={{ flex: 1 }}
                        onClick={() => onGo("briefs", { collabId: r.collab.id })}>Open the brief</Button>
                      <Button size="sm" variant="outline" style={{ flex: 1 }}
                        onClick={() => onGo("creators", { creatorId: r.creator?.id })}>Her profile</Button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      {owing.length > 0 && (
        <section>
          <div style={{ marginBottom: 13 }}>
            <h2 style={H2}>She came. The footage never did.</h2>
            <div style={SUB}>The visit happened and nothing has landed in Intake.</div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {owing.map((r) => (
              <Row key={r.id} r={r} state="Nothing has arrived" primary
                action="Ask her for the files"
                onAction={() => onGo("intake", { collabId: r.collab.id })} />
            ))}
          </div>
        </section>
      )}

      {NextStep && (
        <NextStep onGo={() => onGo("intake")} goLabel="Go to Intake">
          Once a branch accepts, its time window becomes the source for every clip's time of day.
        </NextStep>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- briefs -- */

export function BriefsScreen({ collabs, setCollabs, gaps, creators, clips = [], identity,
  selectedId, setSelectedId, onGo, showTechnical, label, branchById, fmtDate,
  acceptedProposal, now, CollabDetail, EmptyState, NextStep, SCENE_WORD = {},
  briefFingerprint, uncoveredChannels, draftShotNotes }) {
  const open = selectedId ? collabs.find((c) => c.id === selectedId) : null;

  if (open && CollabDetail) {
    return (
      <CollabDetail collab={open} gaps={gaps} creators={creators} identity={identity}
        label={label} branchById={branchById} fmtDate={fmtDate} now={now}
        acceptedProposal={acceptedProposal} briefFingerprint={briefFingerprint}
        uncoveredChannels={uncoveredChannels} draftShotNotes={draftShotNotes}
        onBack={() => setSelectedId(null)} onGo={onGo}
        onPatch={(patch) => setCollabs(collabs.map((c) => c.id === open.id
          ? { ...c, ...patch, updated_at: now() } : c))} />
    );
  }

  const rowsFor = (c) => ({
    c,
    creator: creators.find((x) => x.id === c.creator_id),
    branch: branchById(c.branch_id),
    shots: c.brief_shot_list ?? [],
    accepted: acceptedProposal(c),
    frames: clips.filter((k) => k.collab_id === c.id).slice(0, 3).map((k) => (k.thumbs ?? [])[0]),
  });

  const all = collabs.map(rowsFor);
  const drafts = all.filter((r) => !r.c.brief_approved_by);
  const sent = all.filter((r) => r.c.brief_approved_by && !r.accepted);
  const locked = all.filter((r) => r.c.brief_approved_by && r.accepted);

  /* A real sentence, not a count. "4 clips of the sauna, nobody in frame"
     tells you whether the brief is right; "2 shots" does not. */
  const shotLine = (sh) => {
    const scene = Array.isArray(sh.scene) ? sh.scene[0] : sh.scene;
    const s = scene ? (SCENE_WORD[scene] ?? label(scene).toLowerCase()) : null;
    return `${sh.count} clip${sh.count === 1 ? "" : "s"} of the ${label(sh.room_type).toLowerCase()}`
      + (s ? `, ${s}` : "");
  };

  const Card = ({ r, state, tone, actionLabel, primary, onAction, isLocked }) => (
    <article className="cc-lift" style={{ ...CARD, overflow: "hidden", display: "flex",
      flexDirection: "column" }}>
      <button onClick={() => setSelectedId(r.c.id)}
        style={{ background: "none", border: 0, padding: 0, cursor: "pointer", textAlign: "left",
          display: "flex", flexDirection: "column" }}>
        <span style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gridTemplateRows: "120px",
          height: 120, gap: 2, overflow: "hidden", background: "var(--hairline)" }}>
          {[0, 1, 2].map((i) => (
            <span key={i} aria-hidden="true" style={{ display: "block", minHeight: 0,
              background: "var(--hairline) center/cover no-repeat",
              backgroundImage: r.frames[i] ? `url(${r.frames[i]})` : "none" }} />
          ))}
        </span>

        <span style={{ padding: 16, display: "flex", flexDirection: "column", gap: 14 }}>
          <span style={{ display: "flex", alignItems: "center", gap: 11 }}>
            <Frame src={r.creator?.photo} alt={r.creator?.display_name} size={38} radius={999} />
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: "block", fontSize: 15, fontWeight: 500, letterSpacing: "-0.01em" }}>
                {r.creator?.display_name ?? "Creator not on the roster"}
              </span>
              <span style={{ display: "block", marginTop: 2, fontSize: 12, color: "var(--text-meta)" }}>
                {r.branch?.name}
                {r.shots.length > 0 && ` · ${r.shots.reduce((n, s) => n + s.count, 0)} clips, `
                  + `${new Set(r.shots.map((s) => s.room_type)).size} room`
                  + (new Set(r.shots.map((s) => s.room_type)).size === 1 ? "" : "s")}
              </span>
            </span>
            {isLocked && (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-meta)"
                strokeWidth="1.8" role="img" aria-label="Locked" style={{ flex: "none" }}>
                <rect x="4" y="10.5" width="16" height="10" rx="2.5" />
                <path d="M8 10.5V7.5a4 4 0 018 0v3" />
              </svg>
            )}
          </span>

          <span style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {r.shots.length === 0 ? (
              <span style={{ fontSize: 13, color: "var(--text-meta)" }}>No shots written down yet.</span>
            ) : r.shots.slice(0, 3).map((sh) => (
              <span key={sh.id} style={{ display: "flex", alignItems: "flex-start", gap: 9,
                fontSize: 13, color: "var(--text-body)", lineHeight: 1.5 }}>
                <span aria-hidden="true" style={{ width: 5, height: 5, marginTop: 6, borderRadius: 999,
                  flex: "none", background: "var(--accent)" }} />
                {shotLine(sh)}
              </span>
            ))}
          </span>

          <span style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 13,
            color: tone }}>
            <span aria-hidden="true" style={{ width: 5, height: 5, borderRadius: 999, flex: "none",
              background: tone }} />
            {state}
          </span>
        </span>
      </button>

      <div style={{ margin: "0 16px 16px", paddingTop: 13,
        boxShadow: "inset 0 0.5px 0 var(--hairline)", display: "flex", alignItems: "center",
        justifyContent: "space-between", gap: 10 }}>
        <span style={{ fontSize: 12, color: "var(--text-meta)" }}>
          {r.c.brief_approved_at
            ? `Approved ${fmtDate(String(r.c.brief_approved_at).slice(0, 10))}`
            : `Started ${fmtDate(String(r.c.created_at).slice(0, 10))}`}
        </span>
        <Button size="sm" variant={primary ? "primary" : "outline"} onClick={onAction}>
          {actionLabel}
        </Button>
      </div>
    </article>
  );

  const Group = ({ title, sub, rows, render }) => rows.length === 0 ? null : (
    <section>
      <div style={{ marginBottom: 13 }}>
        <h2 style={H2}>{title}</h2>
        <div style={SUB}>{sub}</div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))",
        gap: 16 }}>{rows.map(render)}</div>
    </section>
  );

  return (
    <div style={{ maxWidth: 1180, display: "flex", flexDirection: "column", gap: 26 }}>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between",
        gap: 20, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 32, lineHeight: 1.1, letterSpacing: "-0.03em",
            fontWeight: 500 }}>What we've asked creators to shoot</h1>
          <div style={{ marginTop: 9, fontSize: 14, color: "var(--text-body)" }}>
            <span className="cc-num">{drafts.length}</span> still to finish
            {" · "}<span className="cc-num">{sent.length}</span> waiting on a date
            {" · "}<span className="cc-num">{locked.length}</span> locked and booked
          </div>
        </div>
        <Button variant="primary" size="lg" style={{ flex: "none" }}
          onClick={() => onGo("creators")}>Write a brief</Button>
      </div>

      {collabs.length === 0 && EmptyState ? (
        <EmptyState skeleton="cards" title="Nothing has been asked of anyone yet"
          body="A brief is one creator, one branch, and the gaps a single visit should close."
          then="Picking a creator creates a draft brief here."
          action={<Button variant="primary" onClick={() => onGo("creators")}>Pick a creator</Button>} />
      ) : (
        <>
          <Group title="Finish these and send them"
            sub="She cannot be booked until the brief goes out." rows={drafts}
            render={(r) => (
              <Card key={r.c.id} r={r} tone="var(--warn)"
                state={r.c.rights?.entered_by ? "Not approved yet" : "Rights are not filled in yet"}
                actionLabel="Finish the brief" primary onAction={() => setSelectedId(r.c.id)} />
            )} />

          <Group title="Waiting on a date"
            sub="Approved. Nothing is booked until a branch says yes." rows={sent}
            render={(r) => (
              <Card key={r.c.id} r={r} tone="var(--text)"
                state={(r.c.visit_proposals ?? []).length ? "A date is with the branch" : "No date asked for yet"}
                actionLabel="See the visit" onAction={() => onGo("visits", { collabId: r.c.id })} />
            )} />

          <Group title="Accepted — the shot list is locked"
            sub="Nobody can change these now, including us." rows={locked}
            render={(r) => (
              <Card key={r.c.id} r={r} tone="var(--accent)" isLocked
                state={`She comes ${fmtDate(r.accepted.date)}`}
                actionLabel="See the visit" onAction={() => onGo("visits", { collabId: r.c.id })} />
            )} />
        </>
      )}

      {NextStep && (
        <NextStep onGo={() => onGo("visits")} goLabel="Go to Visits">
          Approving a brief is what lets you ask a branch for a date.
        </NextStep>
      )}
    </div>
  );
}

/* --------------------------------------------------------------- sidebar -- */

/** The stage list, for the drawer the phone opens. */
export function SidebarBody({ stages, stage, onNavigate, setStage, stageCount, states = {} }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.09em",
        color: "var(--text-meta)", padding: "0 10px 6px" }}>Stages</div>
      {stages.map((st) => {
        const active = stage === st.id;
        const n = stageCount?.(st.id);
        return (
          <button key={st.id} className="cc-nav"
            onClick={() => { setStage(st.id); onNavigate?.(); }}
            aria-current={active ? "page" : undefined}
            style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 10px",
              borderRadius: 11, border: 0, cursor: "pointer", textAlign: "left", width: "100%",
              background: active ? "var(--text)" : "transparent",
              color: active ? "var(--on-dark)" : "var(--text-body)" }}>
            <st.icon size={17} strokeWidth={1.7} aria-hidden="true" style={{ flex: "none" }} />
            <span style={{ flex: 1, fontSize: 14, fontWeight: active ? 500 : 400 }}>{st.name}</span>
            {n !== null && n !== undefined && (
              <span className="cc-num" style={{ fontSize: 12,
                color: active ? "var(--hairline-2)" : "var(--text-meta)" }}>{n}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
