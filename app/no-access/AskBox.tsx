"use client";

import { useState } from "react";
import type { NoAccessView } from "@/lib/accessRequests";

/** "28 Nov" (UX-PRINCIPLES date format; UTC so the server and the browser print the same day). */
export const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }) : "");

/** The ask part of the no-access page: one button "Ask for access", an optional one-line reason, then the answer. */
export default function AskBox({ view }: { view: NoAccessView }) {
  const [asked, setAsked] = useState<string | null>(view.open?.at ?? null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [has, setHas] = useState(false);

  const ask = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/access/ask", {
        method: "POST", headers: { "Content-Type": "application/json" }, cache: "no-store",
        body: JSON.stringify({ grantId: view.grantId, reason }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Your ask did not go through.");
      if (data.state === "has") setHas(true);
      else setAsked(data.at ?? new Date().toISOString());
    } catch (e) {
      setError(`${(e as Error).message} Try again.`);
    } finally {
      setBusy(false);
    }
  };

  if (has) {
    return (
      <>
        <h1>You have {view.full}</h1>
        <div className="pl-row" style={{ marginTop: 20 }}><a className="pl-btn pl-btn-main" href={view.openHref} target="_top">Open {view.name}</a></div>
      </>
    );
  }
  if (asked) {
    return (
      <>
        <h1>You asked for {view.full}</h1>
        <p className="pl-dim">{view.line}</p>
        <p className="pl-note pl-ok" role="status">Asked on {day(asked)}. {view.deciders} will answer.</p>
        <p className="pl-small">You will see the answer here and on Home.</p>
        <div className="pl-row" style={{ marginTop: 12 }}><a className="pl-btn" href="/" target="_top">Back to Home</a></div>
      </>
    );
  }
  const last = view.last;
  return (
    <>
      <h1>{view.full} is not open for you{last?.state === "declined" ? "" : " yet"}</h1>
      <p className="pl-dim">{view.line}</p>
      {last?.state === "declined" && (
        <p className="pl-note pl-err">Declined on {day(last.at)}{last.by ? ` by ${last.by}` : ""}.{last.note ? ` "${last.note}"` : ""}</p>
      )}
      <p>{view.ownerOnly ? `${view.deciders} decides who can open it.` : `${view.deciders} decide who can open it.`}</p>
      <label htmlFor="ask-reason" className="pl-small" style={{ display: "block", margin: "18px 0 6px" }}>Why do you need it? (optional)</label>
      <input id="ask-reason" className="pl-input" maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)}
        placeholder="For example: I review editor trials" onKeyDown={(e) => { if (e.key === "Enter" && !busy) ask(); }} />
      {error && <p className="pl-note pl-err" role="alert" style={{ marginTop: 12 }}>{error}</p>}
      <div className="pl-row" style={{ marginTop: 16 }}>
        <button className="pl-btn pl-btn-main" onClick={ask} disabled={busy}>{busy ? "Asking..." : last?.state === "declined" ? "Ask again" : "Ask for access"}</button>
        <a className="pl-link" href="/" target="_top">Back to Home</a>
      </div>
    </>
  );
}
