import React, { useEffect, useRef } from "react";

/* ============================================================================
   The small pieces every screen is built from.

   These were lost when an automated colour replacement cut a span out of the
   file. They are rewritten here rather than recovered from an older copy on
   purpose: an older copy would carry the old visual layer back in with it, and
   that layer is the thing four rounds of work went into removing.

   Nothing here holds a colour of its own. Every value is a token, so the whole
   set follows the palette into dark and back without any of them knowing that
   dark exists.
============================================================================ */

const RING = "0 0 0 0.5px var(--hairline), 0 1px 2px rgba(28,25,23,0.03)";

/* ------------------------------------------------------------- controls --- */

/**
 * One button.
 *
 * Height is fixed per size because a row of buttons with different label
 * lengths should still line up, and padding alone does not guarantee that.
 */
export function Button({ variant = "outline", size = "md", className = "", style, ...p }) {
  const base = "inline-flex items-center justify-center gap-2 font-medium transition-colors "
    + "focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 "
    + "disabled:opacity-40 disabled:cursor-not-allowed";
  const variants = {
    primary: "cc-btn-accent", accept: "cc-btn-accent", violet: "cc-btn-quiet",
    ghost: "cc-btn-ghost", outline: "cc-btn-outline", danger: "cc-btn-danger",
  };
  const sizes = { sm: "text-xs px-3", md: "text-sm px-4", lg: "text-base px-5" };
  const heights = { sm: 32, md: 40, lg: 44 };
  return (
    <button className={`${base} ${sizes[size]} ${variants[variant] ?? variants.outline} ${className}`}
      style={{ height: heights[size], borderRadius: size === "sm" ? 9 : 11, ...style }} {...p} />
  );
}

/** A small state word. Never a filled colour block - a dot and a word. */
export function Chip({ tone = "slate", children }) {
  const tones = {
    slate:   { bg: "var(--page)",         fg: "var(--text-body)",    dot: "var(--hairline-2)" },
    emerald: { bg: "var(--accent-tint)",  fg: "var(--accent)",       dot: "var(--accent)" },
    amber:   { bg: "var(--warn-tint)",    fg: "var(--warn-text)",    dot: "var(--warn)" },
    rose:    { bg: "var(--blocked-tint)", fg: "var(--blocked-text)", dot: "var(--blocked)" },
    violet:  { bg: "var(--model-tint)",   fg: "var(--model-text)",   dot: "var(--model)" },
  };
  const t = tones[tone] ?? tones.slate;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12,
      borderRadius: 8, padding: "4px 9px", background: t.bg, color: t.fg, whiteSpace: "nowrap" }}>
      <span aria-hidden="true" style={{ width: 5, height: 5, borderRadius: 999, flex: "none",
        background: t.dot }} />
      {children}
    </span>
  );
}

/** A labelled input row. The label is a real label, so the hit area includes it. */
export function Field({ label, required, hint, error, children }) {
  return (
    <label style={{ display: "block", marginBottom: 14 }}>
      <span style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between",
        gap: 12, marginBottom: 5 }}>
        <span style={{ fontSize: 12, color: "var(--text-meta)" }}>
          {label}{required && <span aria-hidden="true" style={{ color: "var(--blocked)" }}> *</span>}
        </span>
        {hint && <span style={{ fontSize: 12, color: "var(--text-meta)" }}>{hint}</span>}
      </span>
      {children}
      {error && (
        <span style={{ display: "block", marginTop: 5, fontSize: 12, color: "var(--blocked-text)" }}>
          {error}
        </span>
      )}
    </label>
  );
}

/** One controlled value, chosen from a list, rendered through its human name. */
export function SingleSelect({ options, value, onChange, placeholder = "Select…",
  labelFn = (v) => v, className = "cc-input", disabled }) {
  return (
    <select className={className} value={value ?? ""} disabled={disabled}
      onChange={(e) => onChange(e.target.value || null)}>
      <option value="">{placeholder}</option>
      {options.map((o) => {
        const v = typeof o === "string" ? o : o.value;
        const l = typeof o === "string" ? labelFn(o) : o.label;
        return <option key={v} value={v}>{l}</option>;
      })}
    </select>
  );
}

/* ------------------------------------------------------------- surfaces --- */

/** A card with a heading. The same shape every rebuilt screen uses. */
export function Section({ title, hint, children, right }) {
  return (
    <section style={{ background: "var(--surface)", borderRadius: 18, padding: 22, marginBottom: 22,
      boxShadow: RING }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 16, marginBottom: hint ? 6 : 16,
        flexWrap: "wrap" }}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 500, letterSpacing: "-0.015em", flex: 1 }}>
          {title}
        </h2>
        {right}
      </div>
      {hint && (
        <p style={{ margin: "0 0 16px", fontSize: 13, color: "var(--text-body)", lineHeight: 1.55,
          maxWidth: "60ch" }}>{hint}</p>
      )}
      {children}
    </section>
  );
}

/**
 * A dialog.
 *
 * Escape closes it, focus goes inside on open, and the backdrop closes it only
 * when the caller allows - a modal that asks a question you can dismiss by
 * clicking past it collects accidental answers.
 */
export function Modal({ open, title, subtitle, children, footer, onClose, dismissable = true, wide }) {
  const box = useRef(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === "Escape" && dismissable) onClose?.(); };
    document.addEventListener("keydown", onKey);
    box.current?.querySelector("input,select,textarea,button")?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [open, dismissable, onClose]);

  if (!open) return null;
  return (
    <div role="dialog" aria-modal="true" aria-label={title}
      onMouseDown={(e) => { if (dismissable && e.target === e.currentTarget) onClose?.(); }}
      style={{ position: "fixed", inset: 0, zIndex: 60, background: "rgba(28,25,23,0.45)",
        display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div ref={box} style={{ background: "var(--surface)", borderRadius: 18, width: "100%",
        maxWidth: wide ? 760 : 520, maxHeight: "88vh", display: "flex", flexDirection: "column",
        boxShadow: "0 24px 60px rgba(28,25,23,0.28)" }}>
        <div style={{ padding: "20px 22px 0" }}>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 500, letterSpacing: "-0.02em" }}>{title}</h2>
          {subtitle && (
            <p style={{ margin: "5px 0 0", fontSize: 13, color: "var(--text-meta)" }}>{subtitle}</p>
          )}
        </div>
        <div style={{ padding: "16px 22px", overflowY: "auto", flex: 1 }}>{children}</div>
        {footer && (
          <div style={{ padding: "14px 22px 20px", display: "flex", justifyContent: "flex-end",
            gap: 9, boxShadow: "inset 0 0.5px 0 var(--hairline)" }}>{footer}</div>
        )}
      </div>
    </div>
  );
}

/** A panel that comes in from the side. Same rules as Modal, different shape. */
export function Drawer({ open, title, subtitle, children, footer, onClose }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === "Escape") onClose?.(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div role="dialog" aria-modal="true" aria-label={title}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.(); }}
      style={{ position: "fixed", inset: 0, zIndex: 60, background: "rgba(28,25,23,0.45)",
        display: "flex", justifyContent: "flex-end" }}>
      <div style={{ background: "var(--surface)", width: "min(100%, 520px)", height: "100%",
        display: "flex", flexDirection: "column" }}>
        <div style={{ padding: "20px 22px 0", display: "flex", alignItems: "flex-start", gap: 12 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2 style={{ margin: 0, fontSize: 20, fontWeight: 500, letterSpacing: "-0.02em" }}>{title}</h2>
            {subtitle && (
              <p style={{ margin: "5px 0 0", fontSize: 13, color: "var(--text-meta)",
                overflow: "hidden", textOverflow: "ellipsis" }}>{subtitle}</p>
            )}
          </div>
          <Button size="sm" variant="ghost" onClick={onClose} aria-label="Close">Close</Button>
        </div>
        <div style={{ padding: "16px 22px", overflowY: "auto", flex: 1 }}>{children}</div>
        {footer && (
          <div style={{ padding: "14px 22px 20px", display: "flex", justifyContent: "flex-end",
            gap: 9, boxShadow: "inset 0 0.5px 0 var(--hairline)" }}>{footer}</div>
        )}
      </div>
    </div>
  );
}

/** The same thing again, for the phone. A sheet rises from the bottom. */
export function Sheet({ open, title, children, footer, onClose }) {
  if (!open) return null;
  return (
    <div role="dialog" aria-modal="true" aria-label={title}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.(); }}
      style={{ position: "fixed", inset: 0, zIndex: 60, background: "rgba(28,25,23,0.45)",
        display: "flex", alignItems: "flex-end" }}>
      <div style={{ background: "var(--surface)", borderRadius: "18px 18px 0 0", width: "100%",
        maxHeight: "86vh", display: "flex", flexDirection: "column" }}>
        <div style={{ padding: "18px 20px 0" }}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 500 }}>{title}</h2>
        </div>
        <div style={{ padding: "14px 20px", overflowY: "auto", flex: 1 }}>{children}</div>
        {footer && (
          <div style={{ padding: "12px 20px 20px", display: "flex", gap: 9,
            boxShadow: "inset 0 0.5px 0 var(--hairline)" }}>{footer}</div>
        )}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------- provenance --- */

/**
 * Who did a thing, and when.
 *
 * Every decision in this product is signed. This is the one component that
 * shows it, so it stays plain: a name, a verb, a date, and nothing that could
 * be mistaken for a status.
 */
export function Signature({ by, at, verb = "decided" }) {
  if (!by) return null;
  return (
    <span style={{ fontSize: 12, color: "var(--text-meta)" }}>
      {verb} by {by}
      {at && <> · <span className="cc-num">{String(at).slice(0, 10)}</span></>}
    </span>
  );
}

/**
 * Where a number came from.
 *
 * Load-bearing. Violet means a model touched it and neutral means it was
 * computed, and that distinction is the reason half the rules in this product
 * exist, so it keeps its colour in both palettes.
 */
export function SourceBadge({ source }) {
  const model = source === "model";
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11,
      borderRadius: 7, padding: "3px 8px",
      background: model ? "var(--model-tint)" : "var(--page)",
      color: model ? "var(--model-text)" : "var(--text-body)",
      boxShadow: model ? "inset 0 0 0 0.5px var(--model-ring)" : "inset 0 0 0 0.5px var(--hairline)" }}>
      {model ? "read by the model" : "computed"}
    </span>
  );
}
