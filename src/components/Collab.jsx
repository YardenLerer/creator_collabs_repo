import React, { useState, useEffect } from "react";
import { Button, Field, Section, SingleSelect, Modal, Signature } from "./Primitives.jsx";

/* ============================================================================
   The creator card, the brief itself, and asking a branch for a date.

   Rewritten after an automated edit removed them. The brief is the screen with
   the most rules attached to it, and they are all still here: the shot list is
   computed from the gaps and never written by a model, the rights are typed by
   a person, the channel gate stands until somebody overrides it with a reason,
   and approving locks the list.
============================================================================ */

const RING = "0 0 0 0.5px var(--hairline), 0 1px 2px rgba(28,25,23,0.03)";
const CARD = { background: "var(--surface)", borderRadius: 16, boxShadow: RING };

function Frame({ src, alt, size, height, radius }) {
  return (
    <span role={alt ? "img" : undefined} aria-label={alt || undefined}
      aria-hidden={alt ? undefined : "true"}
      style={{ width: size, height: height ?? size, flex: "none", borderRadius: radius,
        display: "block", background: "var(--hairline) center/cover no-repeat",
        backgroundImage: src ? `url(${src})` : "none" }} />
  );
}

/* ---------------------------------------------------------- creator card -- */

/**
 * One creator on the roster.
 *
 * The card leads with her work, not her name. Somebody picking a person to
 * shoot a sauna is looking for footage that looks like a sauna, and a row of
 * text with a small round photograph makes them open nine profiles to find
 * out.
 */
export function CreatorCard({ creator, record, onOpen, onStartCollab, showTechnical,
  thumbUrls = {}, thumbsFor, label, branchById, Avatar, Speciality, Recommendation }) {
  const branch = branchById(creator.nearest_branch_id);
  const shots = (record?.clips ?? []).flatMap((c) => thumbsFor(c, thumbUrls)).filter(Boolean).slice(0, 3);
  const kept = record?.decided > 0 ? `${record.accepted} of ${record.decided} kept` : null;

  return (
    <article className="cc-lift" style={{ ...CARD, overflow: "hidden", display: "flex",
      flexDirection: "column" }}>
      <button onClick={onOpen} style={{ background: "none", border: 0, padding: 0, cursor: "pointer",
        textAlign: "left", display: "flex", flexDirection: "column" }}>

        {shots.length >= 3 ? (
          <span aria-hidden="true" style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr",
            gridTemplateRows: "116px", height: 116, gap: 2, overflow: "hidden",
            background: "var(--hairline)" }}>
            {shots.map((src, i) => (
              <span key={i} style={{ display: "block", minHeight: 0,
                background: "var(--hairline) center/cover no-repeat", backgroundImage: `url(${src})` }} />
            ))}
          </span>
        ) : (
          <span style={{ height: 116, background: "var(--page)", display: "flex",
            alignItems: "center", justifyContent: "center", fontSize: 13, color: "var(--text-meta)" }}>
            Nothing shot with us yet
          </span>
        )}

        <span style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
          <span style={{ display: "flex", alignItems: "center", gap: 11 }}>
            <Avatar name={creator.display_name} photo={creator.photo} size={40} />
            <span style={{ minWidth: 0, flex: 1 }}>
              <span style={{ display: "block", fontSize: 16, fontWeight: 500,
                letterSpacing: "-0.012em", lineHeight: 1.3 }}>{creator.display_name}</span>
              <span style={{ display: "block", fontSize: 12, color: "var(--text-meta)" }}>
                {creator.handle}{branch ? ` · ${branch.name}` : ""}
              </span>
            </span>
          </span>

          {(creator.creator_vertical ?? []).length > 0 && Speciality && (
            <span style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {creator.creator_vertical.slice(0, 3).map((v) => <Speciality key={v} value={v} />)}
            </span>
          )}

          {(creator.notes ?? []).length > 0 && Recommendation && (
            <span style={{ display: "block" }}>
              <Recommendation notes={creator.notes} size={13} />
            </span>
          )}

          <span style={{ display: "flex", alignItems: "center", gap: 8, paddingTop: 11,
            boxShadow: "inset 0 0.5px 0 var(--hairline)", fontSize: 12, color: "var(--text-meta)" }}>
            <span aria-hidden="true" style={{ width: 5, height: 5, borderRadius: 999, flex: "none",
              background: record?.submitted ? "var(--accent)" : "var(--hairline-2)" }} />
            <span className="cc-num" style={{ flex: 1 }}>
              {record?.submitted
                ? `${record.submitted} clip${record.submitted === 1 ? "" : "s"} handed in`
                : "New to us"}
            </span>
            {kept && <span className="cc-num">{kept}</span>}
          </span>
        </span>
      </button>

      <div style={{ padding: "0 16px 16px" }}>
        <Button size="sm" variant="primary" onClick={onStartCollab} style={{ width: "100%" }}>
          Start a collab
        </Button>
      </div>

      {showTechnical && (
        <div style={{ padding: "0 16px 12px", fontSize: 11, color: "var(--text-meta)" }}>{creator.id}</div>
      )}
    </article>
  );
}

/* --------------------------------------------------------------- a date --- */

/**
 * Asking a branch for a date.
 *
 * The branch answers this, not us. Everything here is a proposal until
 * somebody at the branch says yes, and the wording keeps saying so - a screen
 * that reads as if the date is booked produces creators arriving at closed
 * rooms.
 */
export function ProposeDate({ collab, identity, onClose, onSave, label, TIME_OF_DAY, DURATION, now }) {
  const [date, setDate] = useState("");
  const [tod, setTod] = useState("morning");
  const [dur, setDur] = useState("one_hour");
  const [note, setNote] = useState("");

  const ok = /^\d{4}-\d{2}-\d{2}$/.test(date);

  return (
    <Modal open title="Ask the branch for a date"
      subtitle="Nothing is booked until they answer."
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!ok}
            onClick={() => onSave({
              id: `vp_${Math.random().toString(36).slice(2, 9)}`,
              collab_id: collab.id, date, time_of_day: tod, duration: dur,
              note: note.trim() || null, status: "pending",
              proposed_by: identity, proposed_at: now(),
              responded_by: null, responded_at: null,
              decline_reason: null, decline_note: null,
            })}>
            Send it to the branch
          </Button>
        </>
      }>
      <Field label="Which day?" required>
        <input className="cc-input" type="date" value={date}
          onChange={(e) => setDate(e.target.value)} />
      </Field>
      <Field label="When in the day?" required
        hint="Whatever the branch confirms becomes the time of day on every clip">
        <SingleSelect options={TIME_OF_DAY} value={tod} onChange={setTod} labelFn={label} />
      </Field>
      <Field label="How long does she need?" required>
        <SingleSelect options={DURATION} value={dur} onChange={setDur} labelFn={label} />
      </Field>
      <Field label="Anything the branch should know?"
        hint="Optional, and they will read it">
        <textarea className="cc-input" rows={3} value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="She brings her own lighting, no staff needed." />
      </Field>
      <p style={{ margin: 0, fontSize: 12, color: "var(--text-meta)" }}>
        Signed as {identity}.
      </p>
    </Modal>
  );
}

/* ---------------------------------------------------------------- brief --- */

/**
 * One brief.
 *
 * Three blocks, and the order is the order of consequence: what she is being
 * asked to shoot, what may be done with the footage, and where the brief has
 * got to.
 *
 * The shot list is computed from the gaps. A model can write the instructions
 * on a shot - that is craft - but never the room, the count or the format,
 * because those are derived and a guess would quietly replace a calculation
 * nobody would think to re-check.
 */
export function CollabDetail({ collab, gaps, creators, identity, onBack, onPatch, onGo,
  label, branchById, fmtDate, now, acceptedProposal, briefFingerprint, uncoveredChannels,
  deriveShotList, RIGHTS_FIELDS = [], draftShotNotes }) {
  const creator = creators.find((c) => c.id === collab.creator_id);
  const branch = branchById(collab.branch_id);
  const collabGaps = (collab.gap_ids ?? []).map((id) => gaps.find((g) => g.id === id)).filter(Boolean);
  const shotList = collab.brief_shot_list ?? [];
  const accepted = acceptedProposal(collab);
  const approved = !!collab.brief_approved_by;
  const stale = briefFingerprint
    ? collab.brief_fingerprint !== briefFingerprint(collabGaps) : false;
  const uncovered = uncoveredChannels ? uncoveredChannels(collabGaps, collab.rights) : [];

  const [notesRunning, setNotesRunning] = useState(false);
  const [notesFailure, setNotesFailure] = useState(null);

  const blockers = [];
  if (shotList.length === 0) blockers.push("The shot list is empty.");
  if (!collab.rights?.entered_by) blockers.push("Rights have not been entered and signed.");
  if (uncovered.length > 0 && !collab.channel_override) {
    blockers.push(`Rights do not cover ${uncovered.map(label).join(", ")}.`);
  }
  if (stale) blockers.push("A gap changed after this brief was built. Rebuild it.");
  const canApprove = blockers.length === 0;

  const steps = [
    { t: "Written", done: shotList.length > 0,
      when: shotList.length ? `${shotList.length} shot${shotList.length === 1 ? "" : "s"}` : "nothing yet" },
    { t: "Rights typed in", done: !!collab.rights?.entered_by,
      when: collab.rights?.entered_by ? `by ${collab.rights.entered_by}` : "not entered" },
    { t: "Ready to send", done: canApprove,
      when: canApprove ? "everything it needs is here" : blockers[0] ?? "" },
    { t: "Approved", done: approved,
      when: approved ? `by ${collab.brief_approved_by}` : "not yet" },
    { t: "Visit booked", done: !!accepted,
      when: accepted ? fmtDate(accepted.date) : "the branch has not answered" },
  ];

  const writeTheHow = async () => {
    setNotesRunning(true); setNotesFailure(null);
    const out = [];
    for (const sh of shotList) {
      const r = await draftShotNotes({ shot: sh, label });
      if (!r.ok) { setNotesFailure(r); break; }
      out.push({ ...sh, instruction: r.instruction, note: r.note, notes_by: "model" });
    }
    if (out.length === shotList.length) onPatch({ brief_shot_list: out });
    setNotesRunning(false);
  };

  return (
    <div style={{ maxWidth: 1180 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13,
        color: "var(--text-meta)", marginBottom: 22 }}>
        <button onClick={onBack} style={{ color: "var(--text-body)", background: "none", border: 0,
          cursor: "pointer", padding: 0, fontSize: 13 }}>Briefs</button>
        <span aria-hidden="true">›</span>
        <span style={{ color: "var(--text)" }}>{creator?.display_name} at {branch?.name}</span>
      </div>

      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between",
        gap: 20, flexWrap: "wrap", marginBottom: 22 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 32, lineHeight: 1.1, letterSpacing: "-0.03em",
            fontWeight: 500 }}>
            What we're asking {creator?.display_name?.split(" ")[0] ?? "her"} to shoot
          </h1>
          <div style={{ marginTop: 9, fontSize: 14, color: "var(--text-body)" }}>
            {approved
              ? <>Approved by {collab.brief_approved_by} · {fmtDate(String(collab.brief_approved_at).slice(0, 10))}</>
              : "Draft · she has not seen it yet"}
            {stale && " · a gap changed underneath it"}
          </div>
        </div>
      </div>

      <div style={{ display: "flex", gap: 22, alignItems: "flex-start", flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 560px", minWidth: "min(100%, 540px)" }}>

          <Section title="The shot list"
            hint="What to shoot is computed from the gaps - the gap holds every value a shot needs. How to shoot it is craft, and that is the only part the model writes."
            right={
              <Button size="sm" variant="violet" disabled={notesRunning || shotList.length === 0 || approved}
                onClick={writeTheHow}>
                {notesRunning ? "Writing…" : "Write the how"}
              </Button>
            }>
            {notesFailure && (
              <div role="alert" style={{ background: "var(--blocked-tint)", borderRadius: 12,
                padding: "12px 14px", marginBottom: 14, boxShadow: "inset 3px 0 0 var(--blocked)" }}>
                <p style={{ margin: 0, fontSize: 13, fontWeight: 500, color: "var(--blocked-text)" }}>
                  {notesFailure.title}
                </p>
                <p style={{ margin: "3px 0 0", fontSize: 13, color: "var(--blocked-text)",
                  lineHeight: 1.5 }}>{notesFailure.detail}</p>
              </div>
            )}

            {shotList.length === 0 ? (
              <p style={{ margin: 0, fontSize: 14, color: "var(--text-meta)" }}>
                Nothing computed yet. The shot list comes from the gaps this collab was created against.
              </p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                {shotList.map((sh) => (
                  <div key={sh.id} style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
                    <Frame size={64} height={80} radius={10} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 15, lineHeight: 1.45 }}>
                        <span className="cc-num">{sh.count}</span>
                        {" "}clip{sh.count === 1 ? "" : "s"} of the {label(sh.room_type).toLowerCase()}
                      </div>
                      {sh.instruction && (
                        <p style={{ margin: "6px 0 0", fontSize: 13, color: "var(--text-body)",
                          lineHeight: 1.55 }}>{sh.instruction}</p>
                      )}
                      <div style={{ marginTop: 9, display: "flex", gap: 6, flexWrap: "wrap" }}>
                        {[sh.count && `${sh.count} clips`, sh.aspect && label(sh.aspect),
                          sh.lighting && label(sh.lighting), sh.room_type && label(sh.room_type)]
                          .filter(Boolean).map((c) => (
                          <span key={c} style={{ fontSize: 12, borderRadius: 8, padding: "4px 9px",
                            background: "var(--page)", color: "var(--text-body)",
                            boxShadow: "inset 0 0 0 0.5px var(--hairline)" }}>{c}</span>
                        ))}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Section>

          <Section title="What we may do with the footage"
            hint="Entered by a person. The model never sees the agreement, so it never touches this block.">
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
              gap: "14px 20px" }}>
              {[["Channels", (collab.rights?.channels ?? []).map(label).join(", ")],
                ["Territory", collab.rights?.territory && label(collab.rights.territory)],
                ["How long", collab.rights?.duration && label(collab.rights.duration)],
                ["Expires", collab.rights?.expires_at],
                ["Credit", collab.rights?.credit_required && label(collab.rights.credit_required)],
                ["Agreed how", collab.rights?.agreement_form && label(collab.rights.agreement_form)],
              ].map(([k, v]) => (
                <div key={k}>
                  <div style={{ fontSize: 12, color: "var(--text-meta)" }}>{k}</div>
                  <div style={{ marginTop: 3, fontSize: 14 }}>{v || "Not agreed"}</div>
                </div>
              ))}
            </div>
            {collab.rights?.entered_by && (
              <div style={{ marginTop: 14, paddingTop: 12,
                boxShadow: "inset 0 0.5px 0 var(--hairline)" }}>
                <Signature by={collab.rights.entered_by} at={collab.rights.entered_at} verb="entered" />
              </div>
            )}
          </Section>

          <div style={{ display: "flex", alignItems: "flex-start", gap: 11,
            background: "var(--blocked-tint)", borderRadius: 12, padding: "13px 15px",
            boxShadow: "inset 3px 0 0 var(--blocked)", marginBottom: 22 }}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="var(--blocked-text)"
              strokeWidth="1.8" style={{ flex: "none", marginTop: 1 }} aria-hidden="true">
              <path d="M12 8v5M12 16.5v.5" /><circle cx="12" cy="12" r="9" />
            </svg>
            <div style={{ fontSize: 13, color: "var(--blocked-text)", lineHeight: 1.55 }}>
              Guests may not appear in any clip. If a face is recognisable, the clip is blocked and
              cannot be released, whatever she agreed to.
            </div>
          </div>
        </div>

        <aside style={{ flex: "1 1 300px", minWidth: "min(100%, 300px)", maxWidth: 340,
          display: "flex", flexDirection: "column", gap: 22 }}>
          <section style={{ ...CARD, borderRadius: 18, padding: 20 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
              <Frame src={creator?.photo} alt={creator?.display_name} size={52} radius={999} />
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 15, fontWeight: 500 }}>{creator?.display_name}</div>
                <div style={{ fontSize: 12, color: "var(--text-meta)" }}>
                  {creator?.handle} · {branch?.name}
                </div>
              </div>
            </div>
            <div style={{ display: "flex", gap: 9, flexWrap: "wrap" }}>
              {creator?.email && (
                <a href={`mailto:${creator.email}`} style={{ display: "inline-flex", alignItems: "center",
                  height: 44, padding: "0 14px", borderRadius: 11, background: "var(--page)",
                  color: "var(--text)", fontSize: 14, textDecoration: "none",
                  boxShadow: "0 0 0 0.5px var(--hairline)" }}>Email</a>
              )}
              {creator?.phone && (
                <a href={`https://wa.me/${creator.phone.replace(/[^0-9]/g, "")}`} target="_blank"
                  rel="noreferrer" style={{ display: "inline-flex", alignItems: "center", height: 44,
                    padding: "0 14px", borderRadius: 11, background: "var(--page)", color: "var(--text)",
                    fontSize: 14, textDecoration: "none",
                    boxShadow: "0 0 0 0.5px var(--hairline)" }}>WhatsApp</a>
              )}
            </div>
          </section>

          <section style={{ ...CARD, borderRadius: 18, padding: 20 }}>
            <h2 style={{ margin: "0 0 16px", fontSize: 18, fontWeight: 500,
              letterSpacing: "-0.015em" }}>Where this brief is</h2>
            <div style={{ display: "flex", flexDirection: "column" }}>
              {steps.map((st, i) => {
                const current = !st.done && steps.slice(0, i).every((p) => p.done);
                const dot = st.done ? "var(--accent)" : current ? "var(--text)" : "var(--hairline)";
                return (
                  <div key={st.t} style={{ display: "flex", gap: 13, alignItems: "flex-start" }}>
                    <span style={{ flex: "none", display: "flex", flexDirection: "column",
                      alignItems: "center", width: 14 }}>
                      <span style={{ width: 9, height: 9, borderRadius: 999, background: dot,
                        boxShadow: current ? "0 0 0 3px var(--hairline)" : "none" }} />
                      {i < steps.length - 1 && (
                        <span style={{ width: 1.5, flex: 1, minHeight: 26,
                          background: st.done ? "var(--accent)" : "var(--hairline)" }} />
                      )}
                    </span>
                    <span style={{ flex: 1, minWidth: 0, paddingBottom: 14 }}>
                      <span style={{ display: "block", fontSize: 14,
                        color: st.done || current ? "var(--text)" : "var(--text-meta)" }}>{st.t}</span>
                      <span style={{ display: "block", marginTop: 2, fontSize: 12,
                        color: "var(--text-meta)" }}>{st.when}</span>
                    </span>
                  </div>
                );
              })}
            </div>

            {!approved && (
              <>
                <Button variant="primary" disabled={!canApprove} style={{ width: "100%", marginTop: 4 }}
                  onClick={() => onPatch({ brief_approved_by: identity, brief_approved_at: now() })}>
                  Approve the brief
                </Button>
                <p style={{ margin: "10px 0 0", fontSize: 12, color: "var(--text-meta)",
                  lineHeight: 1.5 }}>
                  {canApprove
                    ? "Approving locks the shot list and the rights, and lets you ask a branch for a date."
                    : blockers[0]}
                </p>
              </>
            )}
            {approved && (
              <Button variant="primary" style={{ width: "100%", marginTop: 4 }}
                onClick={() => onGo("visits", { collabId: collab.id })}>
                {accepted ? "See the visit" : "Book the visit"}
              </Button>
            )}
          </section>

          <section style={{ ...CARD, borderRadius: 18, padding: 20 }}>
            <h2 style={{ margin: "0 0 4px", fontSize: 18, fontWeight: 500,
              letterSpacing: "-0.015em" }}>The visit</h2>
            <div style={{ fontSize: 12, color: "var(--text-meta)" }}>
              The branch confirms this after the brief is approved.
            </div>
            <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 13 }}>
              {[["Branch", branch?.name ?? "—"],
                ["Date asked for", accepted ? fmtDate(accepted.date) : "not asked yet"],
                ["Window", accepted ? label(accepted.time_of_day) : "—"],
                ["How long", accepted ? label(accepted.duration) : "—"]].map(([k, v]) => (
                <div key={k} style={{ display: "flex", justifyContent: "space-between", gap: 12,
                  fontSize: 13 }}>
                  <span style={{ color: "var(--text-meta)" }}>{k}</span><span>{v}</span>
                </div>
              ))}
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
