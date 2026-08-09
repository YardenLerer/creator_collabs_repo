import React, { useState } from "react";

/* ============================================================================
   One creator, everything known about her.

   Rebuilt from Creator profile.dc.html. The values here - the 172x215
   portrait, 18px card radius, 44px contact buttons, the 0.5px ring plus a 1px
   shadow, the two-column wrap rule - are the ones in that file rather than
   approximations of them.

   The figures are counted from rows that exist. A creator with two clips
   behind her gets "not enough yet", never a low score, and every row says in
   plain words where its number came from.
============================================================================ */

const CARD = {
  background: "var(--surface)", borderRadius: 18,
  boxShadow: "0 0 0 0.5px var(--hairline), 0 1px 2px rgba(28,25,23,0.03)",
  padding: 22,
};
const H2 = { margin: 0, fontSize: 18, fontWeight: 500, letterSpacing: "-0.015em" };
const LABEL = { fontSize: 12, color: "var(--text-meta)" };

/** Counts, and a plain statement when there is not enough to count. */
export function creatorRecord(creator, { collabs, clips, gaps = [] }) {
  const mine = collabs.filter((c) => c.creator_id === creator.id);
  const myClips = clips.filter((c) => mine.some((m) => m.id === c.collab_id));

  const decided = myClips.filter((c) => c.clip_status === "accepted" || c.clip_status === "rejected");
  const accepted = myClips.filter((c) => c.clip_status === "accepted");
  const flagged = myClips.filter((c) => (c.quality_flags ?? []).some((f) => f.severity === "blocking"));
  const privacy = myClips.filter((c) => (c.privacy_flags ?? []).length > 0);
  const used = accepted.filter((c) => c.gap_id_closed
    && gaps.some((g) => g.id === c.gap_id_closed && g.status === "closed"));

  const finished = mine.filter((m) => (m.visit_proposals ?? []).some((p) => p.status === "accepted")
    && clips.some((c) => c.collab_id === m.id));
  const onTime = finished.filter((m) => {
    const acc = (m.visit_proposals ?? []).find((p) => p.status === "accepted");
    const first = clips.filter((c) => c.collab_id === m.id).map((c) => c.created_at).sort()[0];
    return acc && first && new Date(first) <= new Date(new Date(acc.date).getTime() + 3 * 86400000);
  });

  const enough = decided.length >= 3;
  const pct = (n, d) => (d > 0 ? Math.round((n / d) * 100) : null);

  return {
    collabs: mine.length, submitted: myClips.length,
    accepted: accepted.length, decided: decided.length,
    clean: decided.length - flagged.length, flagged: flagged.length,
    privacyFlagged: privacy.length, used: used.length,
    finished: finished.length, onTime: onTime.length, enough,
    acceptRate: enough ? pct(accepted.length, decided.length) : null,
    cleanRate: enough ? pct(decided.length - flagged.length, decided.length) : null,
    onTimeRate: finished.length >= 2 ? pct(onTime.length, finished.length) : null,
    useRate: enough ? pct(used.length, decided.length) : null,
    clips: myClips, collabList: mine,
  };
}

/** A contact button. 44px tall, because it is meant to be pressed on a phone. */
function Contact({ href, label, children }) {
  return (
    <a href={href} target={href.startsWith("http") ? "_blank" : undefined} rel="noreferrer"
      style={{ display: "inline-flex", alignItems: "center", gap: 8, height: 44, padding: "0 15px",
        borderRadius: 11, background: "var(--page)", color: "var(--text)", fontSize: 14,
        boxShadow: "0 0 0 0.5px var(--hairline)", textDecoration: "none" }}>
      {children}{label}
    </a>
  );
}

/**
 * One measured row: label, value, a bar, and where the figure came from.
 *
 * Every row is phrased so a fuller bar is the better result. A row worded as a
 * negative - "flags raised" - drawn nearly full reads as a good score at a
 * glance, and nobody scanning an aside stops to re-read it.
 */
function Row({ label, value, pct, from }) {
  return (
    <div>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
        <span style={{ fontSize: 14, color: "var(--text)" }}>{label}</span>
        <span className="cc-num" style={{ fontSize: 14, color: pct === null ? "var(--text-meta)" : "var(--text)" }}>{value}</span>
      </div>
      <div style={{ marginTop: 7, height: 4, borderRadius: 999, background: "var(--hairline)", overflow: "hidden" }}>
        <span style={{ display: "block", height: "100%", borderRadius: 999,
          background: "var(--accent)", width: pct === null ? "0%" : `${pct}%` }} />
      </div>
      <div style={{ marginTop: 6, fontSize: 12, color: "var(--text-meta)", lineHeight: 1.45 }}>{from}</div>
    </div>
  );
}

export default function CreatorProfile({
  creator, record, gaps = [], onBack, onEdit, onStartCollab, onOpenCollab, onAddNote, identity,
  Avatar, Thumb, thumbsFor, thumbUrls, label, branchById, clipSentence, Button, showTechnical,
  Speciality, Recommendation,
}) {
  const [noting, setNoting] = useState(false);
  const [noteText, setNoteText] = useState("");
  const [noteWorked, setNoteWorked] = useState("yes");

  const links = Object.fromEntries((creator.links ?? []).map((l) => [l.platform, l.url]));
  const stats = creator.platform_stats ?? [];
  const followers = stats.reduce((n, s) => n + (s.followers ?? 0), 0);
  const engagement = stats.length
    ? `${(stats.reduce((n, s) => n + parseFloat(s.engagement ?? "0"), 0) / stats.length).toFixed(1)}%`
    : "not given";
  const fits = gaps.filter((g) => g.status === "open"
    && (g.branch_id.length === 0 || g.branch_id.includes(creator.nearest_branch_id))).slice(0, 2);

  const facts = [
    ["Strongest format", (creator.format_strength ?? []).map(label).join(", ")],
    ["Camera", creator.camera],
    ["Lighting", creator.brings_lighting === "yes" ? "Brings her own"
      : creator.brings_lighting === "no" ? "Uses the room" : null],
    ["Shoots with", creator.works_with === "alone" ? "Alone, no crew"
      : creator.works_with === "with_crew" ? "A small crew" : null],
    ["Where she covers", creator.coverage_note],
    ["Active on", (creator.links ?? []).map((l) => label(l.platform)).join(", ")],
  ].filter(([, v]) => v);

  return (
    <div style={{ maxWidth: 1180, display: "flex", flexDirection: "column", gap: 22 }}>

      <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--text-meta)" }}>
        <button onClick={onBack} style={{ color: "var(--text-body)", background: "none", border: 0,
          cursor: "pointer", padding: 0, fontSize: 13 }}>Creators</button>
        <span aria-hidden="true" style={{ color: "var(--text-meta)" }}>›</span>
        <span style={{ color: "var(--text)" }}>{creator.display_name}</span>
      </div>

      {/* ------------------------------------------------------- identity -- */}
      <section style={{ ...CARD, display: "flex", gap: 24, alignItems: "flex-start", flexWrap: "wrap" }}>
        <Avatar name={creator.display_name} photo={creator.photo} size={172} height={215} square />

        <div style={{ flex: "1 1 340px", minWidth: "min(100%, 300px)", display: "flex",
          flexDirection: "column", gap: 16 }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 20 }}>
            <div style={{ minWidth: 0 }}>
              <h1 style={{ margin: 0, fontSize: 32, lineHeight: 1.1, letterSpacing: "-0.03em", fontWeight: 500 }}>
                {creator.display_name}
              </h1>
              {Speciality && (creator.creator_vertical ?? []).length > 0 && (
                <div style={{ marginTop: 10, display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {creator.creator_vertical.map((v) => <Speciality key={v} value={v} />)}
                </div>
              )}
              <div style={{ marginTop: 7, fontSize: 14, color: "var(--text-body)" }}>
                {creator.handle} · Home branch {branchById(creator.nearest_branch_id)?.name ?? "not set"}
                {creator.coverage_note ? ` · ${creator.coverage_note.replace(/\.$/, "")}` : ""}
              </div>
            </div>
            <div style={{ display: "flex", gap: 9, flex: "none" }}>
              <button onClick={onStartCollab}
                style={{ background: "var(--accent)", color: "#fff", border: 0, borderRadius: 11, height: 40,
                  padding: "0 16px", fontSize: 14, fontWeight: 500, cursor: "pointer" }}>
                Start a collab
              </button>
              <button onClick={onEdit} aria-label="Edit her details"
                style={{ background: "var(--surface)", border: 0, borderRadius: 11, width: 40, height: 40,
                  display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer",
                  boxShadow: "0 0 0 0.5px var(--hairline-2)" }}>
                <svg width="17" height="17" viewBox="0 0 24 24" fill="var(--text-body)" aria-hidden="true">
                  <circle cx="5" cy="12" r="1.7" /><circle cx="12" cy="12" r="1.7" /><circle cx="19" cy="12" r="1.7" />
                </svg>
              </button>
            </div>
          </div>

          <div style={{ display: "flex", gap: 9, flexWrap: "wrap" }}>
            {creator.email && (
              <Contact href={`mailto:${creator.email}`} label="Email">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-body)" strokeWidth="1.7" aria-hidden="true">
                  <rect x="3" y="5" width="18" height="14" rx="2.5" /><path d="M4 7.5l8 5.5 8-5.5" />
                </svg>
              </Contact>
            )}
            {creator.phone && (
              <Contact href={`https://wa.me/${creator.phone.replace(/[^0-9]/g, "")}`} label="WhatsApp">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-body)" strokeWidth="1.7" aria-hidden="true">
                  <path d="M4 19l1.2-3.4A7.4 7.4 0 1112 19.4a7.6 7.6 0 01-3.6-.9z" />
                </svg>
              </Contact>
            )}
            {links.instagram && (
              <Contact href={links.instagram} label="Instagram">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-body)" strokeWidth="1.7" aria-hidden="true">
                  <rect x="3.5" y="3.5" width="17" height="17" rx="5" /><circle cx="12" cy="12" r="4" />
                  <circle cx="17" cy="7" r="1" fill="var(--text-body)" stroke="none" />
                </svg>
              </Contact>
            )}
            {links.tiktok && (
              <Contact href={links.tiktok} label="TikTok">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-body)" strokeWidth="1.7" aria-hidden="true">
                  <circle cx="8.5" cy="17" r="3.2" /><path d="M11.7 17V3.8c1 2.4 2.8 3.6 5.5 3.7" />
                </svg>
              </Contact>
            )}
          </div>

          <div style={{ display: "flex", gap: 26, flexWrap: "wrap", paddingTop: 15,
            boxShadow: "inset 0 0.5px 0 var(--hairline)" }}>
            {Recommendation && (creator.notes ?? []).length > 0 && (
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: -2 }}>
                <Recommendation notes={creator.notes} size={16} showCount={false} />
                <span style={{ fontSize: 13, color: "var(--text-body)" }}>
                  {creator.notes.filter((n) => n.worked === "yes").length} of{" "}
                  {creator.notes.filter((n) => n.worked === "yes" || n.worked === "no").length} would book her again
                </span>
              </div>
            )}
            {[[followers >= 1000 ? `${(followers / 1000).toFixed(1)}k` : (followers || "not given"), "Followers"],
              [engagement, "Engagement"],
              [record.submitted, "Clips handed in"],
              [record.finished, "Visits with us"]].map(([v, k]) => (
              <div key={k}>
                <div className="cc-num" style={{ fontSize: 20, letterSpacing: "-0.015em" }}>{v}</div>
                <div style={{ marginTop: 2, ...LABEL }}>{k}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <div style={{ display: "flex", gap: 22, alignItems: "flex-start", flexWrap: "wrap" }}>

        {/* --------------------------------------------------- main column -- */}
        <div style={{ flex: "1 1 560px", minWidth: "min(100%, 560px)", display: "flex",
          flexDirection: "column", gap: 22 }}>

          <section style={CARD}>
            <h2 style={{ ...H2, marginBottom: 12 }}>What she shoots</h2>
            <p style={{ margin: 0, fontSize: 15, lineHeight: 1.6, color: "var(--text-body)", maxWidth: "62ch" }}>
              {creator.style_note || "Nothing has been written about her work yet."}
            </p>
            {facts.length > 0 && (
              <div style={{ marginTop: 20, display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: "18px 24px" }}>
                {facts.map(([k, v]) => (
                  <div key={k}>
                    <div style={LABEL}>{k}</div>
                    <div style={{ marginTop: 4, fontSize: 14 }}>{v}</div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section style={CARD}>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between",
              gap: 16, marginBottom: 14 }}>
              <h2 style={H2}>Her work</h2>
              <span className="cc-num" style={{ fontSize: 13, color: "var(--text-meta)" }}>
                {record.clips.length} clip{record.clips.length === 1 ? "" : "s"}
              </span>
            </div>
            {record.clips.length === 0 ? (
              <p style={{ margin: 0, fontSize: 14, color: "var(--text-meta)" }}>She has not handed anything back yet.</p>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))", gap: 12 }}>
                {record.clips.map((c) => {
                  const gap = c.gap_id_closed ? gaps.find((g) => g.id === c.gap_id_closed) : null;
                  return (
                    <div key={c.id} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      <div style={{ position: "relative", width: "100%", aspectRatio: "4/5",
                        borderRadius: 12, overflow: "hidden", background: "var(--hairline)" }}>
                        <Thumb thumbs={thumbsFor(c, thumbUrls)} alt={clipSentence(c)} />
                      </div>
                      <div style={{ fontSize: 12, color: "var(--text-body)", lineHeight: 1.4 }}>
                        {gap ? "Closed a gap" : c.clip_status === "rejected" ? "Not used" : "In the library"}
                        <span style={{ display: "block", color: "var(--text-meta)", marginTop: 2 }}>
                          {branchById(c.branch_id)?.name}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          <section style={CARD}>
            <h2 style={{ ...H2, marginBottom: 14 }}>Collaborations</h2>
            {record.collabList.length === 0 ? (
              <p style={{ margin: 0, fontSize: 14, color: "var(--text-meta)" }}>Nothing has been started with her yet.</p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                {record.collabList.map((m) => {
                  const acc = (m.visit_proposals ?? []).find((p) => p.status === "accepted");
                  return (
                    <button key={m.id} onClick={() => onOpenCollab?.(m.id)}
                      style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
                        background: "none", border: 0, padding: 0, cursor: "pointer", textAlign: "left" }}>
                      <span aria-hidden="true" style={{ width: 5, height: 5, borderRadius: 999, flex: "none",
                        background: acc ? "var(--accent)" : "#D97706" }} />
                      <span style={{ flex: "1 1 200px", minWidth: 0, fontSize: 14, color: "var(--text)" }}>
                        {(m.brief_shot_list ?? []).map((s) => label(s.room_type)).filter(Boolean).join(", ")
                          || "Brief not written yet"}
                      </span>
                      <span style={{ flex: "none", width: "auto", fontSize: 12, color: "var(--text-meta)" }}>
                        {branchById(m.branch_id)?.name}
                      </span>
                      <span className="cc-num" style={{ flex: "none", width: "auto", fontSize: 12, color: "var(--text-meta)" }}>
                        {acc ? acc.date : "no date yet"}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </section>

          <section style={CARD}>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between",
              gap: 16, marginBottom: 14 }}>
              <h2 style={H2}>What people said after working with her</h2>
              <button onClick={() => setNoting(true)}
                style={{ background: "none", border: 0, fontSize: 13, color: "var(--accent)", cursor: "pointer" }}>
                Write a note
              </button>
            </div>

            {(creator.notes ?? []).length === 0 && !noting && (
              <p style={{ margin: 0, fontSize: 14, color: "var(--text-meta)", lineHeight: 1.55 }}>
                Nothing written yet. After a visit, what went well and what did not is worth two lines here.
                It is the part no measurement catches.
              </p>
            )}

            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {(creator.notes ?? []).map((n, i) => (
                <div key={i} style={{ display: "flex", gap: 12 }}>
                  <span aria-hidden="true" style={{ width: 32, height: 32, flex: "none", borderRadius: 999,
                    background: "var(--model-tint)", color: "var(--model-text)", fontSize: 12, fontWeight: 500,
                    display: "flex", alignItems: "center", justifyContent: "center" }}>
                    {String(n.by ?? "?").split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase()}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 15, lineHeight: 1.55, color: "var(--text)" }}>{n.text}</div>
                    <div style={{ marginTop: 5, fontSize: 12, color: "var(--text-meta)" }}>
                      {n.by} · {String(n.at).slice(0, 10)}{n.worked === "no" ? " · would think twice" : ""}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {noting && (
              <div style={{ marginTop: 16 }}>
                <label htmlFor="cc-note" style={{ ...LABEL, display: "block", marginBottom: 6 }}>
                  What happened, in a line or two
                </label>
                <textarea id="cc-note" rows={3} value={noteText} onChange={(e) => setNoteText(e.target.value)}
                  style={{ width: "100%", fontSize: 14, padding: "10px 12px", borderRadius: 11, border: 0,
                    boxShadow: "0 0 0 0.5px var(--hairline-2)", fontFamily: "inherit", resize: "vertical" }}
                  placeholder="Arrived on time, worked around a booked room without being asked." />
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 14, color: "var(--text-body)" }}>Would you book her again?</span>
                  {[["yes", "Yes"], ["no", "Think twice"]].map(([v, name]) => (
                    <button key={v} onClick={() => setNoteWorked(v)}
                      style={{ fontSize: 13, padding: "6px 12px", borderRadius: 10, cursor: "pointer", border: 0,
                        background: noteWorked === v ? "var(--text)" : "var(--surface)",
                        color: noteWorked === v ? "var(--on-dark)" : "var(--text-body)",
                        boxShadow: noteWorked === v ? "none" : "0 0 0 0.5px var(--hairline-2)" }}>
                      {name}
                    </button>
                  ))}
                  <span style={{ flex: 1 }} />
                  <Button size="sm" variant="ghost" onClick={() => { setNoting(false); setNoteText(""); }}>Cancel</Button>
                  <Button size="sm" variant="primary" disabled={noteText.trim().length < 5}
                    onClick={() => {
                      onAddNote({ text: noteText.trim(), worked: noteWorked, by: identity, at: new Date().toISOString() });
                      setNoting(false); setNoteText("");
                    }}>Save it</Button>
                </div>
                <p style={{ marginTop: 8, ...LABEL }}>
                  Signed as {identity}, so anyone reading it later knows whose view it was.
                </p>
              </div>
            )}
          </section>
        </div>

        {/* --------------------------------------------------------- aside -- */}
        <aside style={{ flex: "1 1 300px", minWidth: "min(100%, 300px)", maxWidth: 340,
          display: "flex", flexDirection: "column", gap: 22 }}>

          <section style={CARD}>
            <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 12 }}>
              <div>
                <h2 style={H2}>How she has done here</h2>
                <div style={{ marginTop: 5, ...LABEL }}>Counted from her own record. No judgement in it.</div>
              </div>
              <div className="cc-num" style={{ fontSize: 28, lineHeight: 1, letterSpacing: "-0.02em" }}>
                {record.enough ? record.acceptRate : "—"}
              </div>
            </div>

            <div style={{ marginTop: 20, display: "flex", flexDirection: "column", gap: 16 }}>
              <Row label="Clips we kept" pct={record.acceptRate}
                value={record.enough ? `${record.accepted} of ${record.decided}` : "Not enough yet"}
                from="From your accept and reject decisions in Intake." />
              <Row label="Clips with no quality flag" pct={record.cleanRate}
                value={record.enough ? `${record.clean} of ${record.decided}` : "Not enough yet"}
                from={record.flagged > 0
                  ? `${record.flagged} came back with a problem. Counted by the clip reader.`
                  : "Counted by the clip reader."} />
              <Row label="Visits she made on time" pct={record.onTimeRate}
                value={record.onTimeRate !== null ? `${record.onTime} of ${record.finished}` : "Not enough yet"}
                from="From the dates the branch confirmed in Visits." />
              <Row label="Clips that closed a gap" pct={record.useRate}
                value={record.enough ? `${record.used} of ${record.decided}` : "Not enough yet"}
                from="From the gaps those clips were accepted against." />
            </div>

            {!record.enough && (
              <p style={{ marginTop: 16, fontSize: 12, color: "var(--text-meta)", lineHeight: 1.45 }}>
                These stay blank until at least three of her clips have been decided on. A rate worked out
                from one or two clips reads like a judgement and is not one.
              </p>
            )}

            {record.privacyFlagged > 0 && (
              <p style={{ marginTop: 12, fontSize: 12, color: "var(--text-meta)", lineHeight: 1.45 }}>
                {record.privacyFlagged} of her clips raised a privacy flag. That is not counted against her -
                a guest walking into shot is nobody's fault - but it is worth knowing before a busy branch.
              </p>
            )}
          </section>

          {(creator.audience_geo ?? []).length > 0 && (
            <section style={CARD}>
              <h2 style={{ ...H2, marginBottom: 4 }}>Where her audience is</h2>
              <div style={LABEL}>Self-reported. We have not measured it.</div>
              <div style={{ marginTop: 18, display: "flex", flexDirection: "column", gap: 14 }}>
                {creator.audience_geo.map((g, i, all) => {
                  const share = Math.round(100 / all.length);
                  return (
                    <div key={g} style={{ display: "flex", alignItems: "center", gap: 12 }}>
                      <span style={{ flex: "none", width: 96, fontSize: 14, color: "var(--text-body)" }}>{label(g)}</span>
                      <span style={{ flex: 1, height: 6, borderRadius: 999, background: "var(--hairline)", overflow: "hidden" }}>
                        <span style={{ display: "block", height: "100%", borderRadius: 999,
                          background: "var(--text)", width: `${share}%` }} />
                      </span>
                      <span className="cc-num" style={{ flex: "none", width: 38, textAlign: "right",
                        fontSize: 13, color: "var(--text)" }}>{share}%</span>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {fits.length > 0 && (
            <section style={CARD}>
              <h2 style={{ ...H2, marginBottom: 14 }}>Open gaps she fits</h2>
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                {fits.map((g) => (
                  <div key={g.id} style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 14, lineHeight: 1.4, color: "var(--text)" }}>
                        {g.room_type.map(label).join(" or ")}
                        {g.scene?.length ? `, ${label(g.scene[0]).toLowerCase()}` : ""}
                      </div>
                      <div className="cc-num" style={{ marginTop: 3, ...LABEL }}>
                        {g.quantity_needed} clips · {g.branch_id.map((b) => branchById(b)?.name)
                          .filter(Boolean).join(" or ") || "any branch"}
                      </div>
                    </div>
                    <button onClick={onStartCollab}
                      style={{ flex: "none", background: "var(--surface)", border: 0, borderRadius: 10, height: 32,
                        padding: "0 11px", fontSize: 13, cursor: "pointer", boxShadow: "0 0 0 0.5px var(--hairline-2)" }}>
                      Ask her
                    </button>
                  </div>
                ))}
              </div>
            </section>
          )}
        </aside>
      </div>

      {showTechnical && <div style={{ fontSize: 12, color: "var(--text-meta)" }}>{creator.id}</div>}
    </div>
  );
}
