"use client";

import { useEffect, useRef, useState } from "react";

/**
 * "This is confusing" (plan R-3258 X6, S5): a small fixed button; one line of text goes to POST /api/feedback with the
 * page and, on /access, the open sub-tab (read from the tab bar at send time). The server takes the person from the
 * session. On a failure the text stays in the box.
 */
export default function FeedbackButton({ page }: { page: "/" | "/access" }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ t: string; ok: boolean } | null>(null);
  const input = useRef<HTMLInputElement>(null);
  // /access shows a fixed "N unsaved changes ... Save" bar at the bottom: sit above it, never on its Save button
  const [lift, setLift] = useState(0);
  useEffect(() => {
    const measure = () => { const bar = document.querySelector(".ax-bar"); setLift(bar ? Math.ceil(bar.getBoundingClientRect().height) : 0); };
    const mo = new MutationObserver(measure);
    mo.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("resize", measure);
    measure();
    return () => { mo.disconnect(); window.removeEventListener("resize", measure); };
  }, []);
  const tabName = () => (typeof document === "undefined" ? null
    : document.querySelector('[role="tab"][aria-selected="true"]')?.textContent?.trim() || null);
  const where = () => (page === "/" ? "Home" : `Access${tabName() ? `, ${tabName()}` : ""}`);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const t = text.replace(/\s+/g, " ").trim();
    if (t.length < 3) { setMsg({ t: "Write a few words first.", ok: false }); input.current?.focus(); return; }
    setBusy(true); setMsg({ t: "Sending...", ok: true });
    try {
      const r = await fetch("/api/feedback", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: t, page, tab: page === "/access" ? tabName() : null }) });
      if (r.status === 204) {
        setText(""); setMsg({ t: "Thanks. The Portal team will look at it.", ok: true });
        setTimeout(() => setOpen((o) => (o ? false : o)), 2500);
      } else {
        const j = await r.json().catch(() => ({} as { error?: string }));
        const why = r.status === 429 ? "You sent several notes just now. Try again later."
          : r.status === 401 ? "Your sign-in has ended. Reload the page." : (typeof j?.error === "string" ? j.error : "Something went wrong.");
        setMsg({ t: `Not sent: ${why} Your text is kept.`, ok: false });
      }
    } catch {
      setMsg({ t: "Not sent: no connection. Your text is kept.", ok: false });
    } finally { setBusy(false); }
  }

  const btn: React.CSSProperties = { minHeight: 44, padding: "0 16px", font: "600 15px var(--font-sans, system-ui)", cursor: "pointer",
    border: "1px solid var(--border-bright)", background: "transparent", color: "var(--text-dim)" };
  return (
    <>
      {open && (
        <div role="dialog" aria-label="This is confusing" onKeyDown={(e) => { if (e.key === "Escape") setOpen(false); }}
          style={{ position: "fixed", right: 16, bottom: 72 + lift, zIndex: 60, width: "min(380px, calc(100vw - 32px))", background: "var(--bg-elevated)",
            border: "1px solid var(--border-bright)", padding: 16, boxShadow: "0 8px 30px rgba(0,0,0,.5)" }}>
          <form onSubmit={send}>
            <label htmlFor="cf-text" style={{ display: "block", fontSize: 15, fontWeight: 600, marginBottom: 8, color: "var(--text)" }}>What was confusing?</label>
            <input id="cf-text" ref={input} autoFocus maxLength={300} autoComplete="off" placeholder="One line is enough" value={text}
              onChange={(e) => setText(e.target.value)}
              style={{ width: "100%", minHeight: 44, padding: "0 12px", border: "1px solid var(--border-bright)", background: "var(--bg)", color: "var(--text)", fontSize: 15 }} />
            <div style={{ fontSize: 13, color: "var(--text-dim)", margin: "8px 0 12px" }}>Sent with your name and the page: {where()}.</div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button type="button" style={btn} onClick={() => setOpen(false)}>Cancel</button>
              <button type="submit" disabled={busy} style={{ ...btn, background: "var(--amber)", borderColor: "var(--amber)", color: "#111", opacity: busy ? 0.5 : 1 }}>Send</button>
            </div>
            {msg && <div aria-live="polite" style={{ fontSize: 14, marginTop: 10, color: msg.ok ? "var(--green)" : "var(--yellow)" }}>{msg.t}</div>}
          </form>
        </div>
      )}
      <button type="button" aria-haspopup="dialog" aria-expanded={open} onClick={() => { setOpen((o) => !o); setMsg(null); }}
        style={{ position: "fixed", right: 16, bottom: 16 + lift, zIndex: 60, minHeight: 44, padding: "0 16px", borderRadius: 22,
          border: "1px solid var(--border-bright)", background: "var(--bg-elevated)", color: "var(--text-dim)", fontSize: 14, fontWeight: 500,
          cursor: "pointer", boxShadow: "0 2px 10px rgba(0,0,0,.4)" }}>
        This is confusing
      </button>
      <div aria-hidden style={{ height: 72 }} />
    </>
  );
}
