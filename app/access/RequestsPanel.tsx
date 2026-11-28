"use client";

import { useCallback, useEffect, useState } from "react";
import "../plain.css";

/**
 * Requests list at the top of /access (X6, R-3258 B8). Asks waiting, oldest first: who, what, why, when, and
 * Approve / Decline for the owner and access admins. Approve goes through setGrants on the server (same rules as a
 * toggle, recorded in History, Undo in the toast and under "Answered"). Portal admins (read only) see the list
 * without buttons. Owner-only asks say "Only Samuel can answer this one." for the access admins.
 */

interface Req {
  id: string; person: { id: string; name: string | null; username: string }; grantId: string; grant: string; line: string;
  approveNote: string | null; ownerOnly: boolean; reason: string | null; at: string; state: string;
  canAnswer: boolean; whyNot: string | null; answeredAt: string | null; by: string | null; note: string | null;
  changeId: string | null; undone: boolean;
}

const day = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC" }) + " UTC" : "");
const nameOf = (p: Req["person"]) => p.name ?? p.username;

async function post(body: unknown) {
  const res = await fetch("/api/access/admin/requests", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), cache: "no-store" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data as { state: string; changeId: string | null };
}

export default function RequestsPanel({ manage, notify, onChanged, openPerson }: {
  manage: boolean;
  notify: (t: { text: string; undo?: string; error?: boolean }) => void;
  onChanged: () => void;
  openPerson: (id: string) => void;
}) {
  const [data, setData] = useState<{ open: Req[]; answered: Req[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [declining, setDeclining] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [rowErr, setRowErr] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    try {
      setError(null);
      const res = await fetch("/api/access/admin/requests", { cache: "no-store" });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || `Request failed (${res.status})`);
      setData(d);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const answer = async (r: Req, action: "approve" | "decline") => {
    setBusy(r.id);
    setRowErr((x) => ({ ...x, [r.id]: "" }));
    try {
      const out = await post({ id: r.id, action, note: action === "decline" ? note : undefined });
      setDeclining(null);
      setNote("");
      notify(action === "approve"
        ? { text: out.changeId ? `${nameOf(r.person)} can now open ${r.grant}.` : `${nameOf(r.person)} already had ${r.grant}.`, undo: out.changeId ?? undefined }
        : { text: `Declined. ${nameOf(r.person)} sees it on their next visit.` });
      await load();
      onChanged();
    } catch (e) {
      setRowErr((x) => ({ ...x, [r.id]: (e as Error).message }));
      await load();
    } finally {
      setBusy(null);
    }
  };

  const undo = async (r: Req) => {
    if (!r.changeId) return;
    setBusy(r.id);
    try {
      const res = await fetch("/api/access/admin/revert", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ changeId: r.changeId }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || `Request failed (${res.status})`);
      notify({ text: `Undone. ${nameOf(r.person)} no longer has ${r.grant}.` });
      await load();
      onChanged();
    } catch (e) {
      setRowErr((x) => ({ ...x, [r.id]: `Undo refused: ${(e as Error).message}` }));
    } finally {
      setBusy(null);
    }
  };

  const open = data?.open ?? [];
  const answered = data?.answered ?? [];
  return (
    <section className="pl pl-card" style={{ padding: 0, marginBottom: 20 }} aria-label="Requests" data-requests={open.length}>
      <div style={{ padding: "14px 16px 4px" }}>
        <h2 style={{ marginBottom: 4 }}>Requests{open.length ? `: ${open.length} waiting` : ""}</h2>
        {!manage && <p className="pl-small">Read only. Samuel and the access admins answer these.</p>}
      </div>
      {error && <div style={{ padding: "0 16px 12px" }}><p className="pl-note pl-err" role="alert">Requests could not load: {error}</p><button className="pl-btn" onClick={load}>Try again</button></div>}
      {!error && !data && <p className="pl-dim" style={{ padding: "0 16px 14px" }} role="status">Loading requests...</p>}
      {data && open.length === 0 && <p className="pl-dim" style={{ padding: "0 16px 14px" }}>Nobody is waiting for access. When someone presses &quot;Ask for access&quot;, it shows here.</p>}
      {open.map((r) => (
        <div className="pl-req" key={r.id} data-ask={r.grantId}>
          <div><b>{nameOf(r.person)}</b>{r.person.name && <span className="pl-small"> @{r.person.username}</span>} asked for <b>{r.grant}</b></div>
          <div className="pl-small">{day(r.at)}{r.line ? ` · ${r.line}` : ""}</div>
          {r.reason && <p className="pl-quote">&quot;{r.reason}&quot;</p>}
          {r.approveNote && <p className="pl-small" style={{ margin: "4px 0 0" }}>{r.approveNote}</p>}
          {rowErr[r.id] && <p className="pl-note pl-err" role="alert" style={{ marginTop: 8 }}>{rowErr[r.id]}</p>}
          {manage && (r.canAnswer ? (
            declining === r.id ? (
              <div className="pl-row" style={{ marginTop: 10 }}>
                <input className="pl-input" style={{ flex: "1 1 220px", width: "auto" }} maxLength={200} placeholder="Why not? (optional, they will see it)"
                  value={note} onChange={(e) => setNote(e.target.value)} aria-label="Why not" />
                <button className="pl-btn pl-btn-warn" disabled={busy === r.id} onClick={() => answer(r, "decline")}>{busy === r.id ? "Saving..." : "Decline"}</button>
                <button className="pl-btn" disabled={busy === r.id} onClick={() => { setDeclining(null); setNote(""); }}>Back</button>
              </div>
            ) : (
              <div className="pl-row" style={{ marginTop: 10 }}>
                <button className="pl-btn pl-btn-main" disabled={busy === r.id} onClick={() => answer(r, "approve")}>{busy === r.id ? "Saving..." : "Approve"}</button>
                <button className="pl-btn" disabled={busy === r.id} onClick={() => { setDeclining(r.id); setNote(""); }}>Decline</button>
                <button className="pl-link" style={{ background: "none", border: 0, font: "inherit", cursor: "pointer" }} onClick={() => openPerson(r.person.id)}>See what they have</button>
              </div>
            )
          ) : r.whyNot && <p className="pl-small" style={{ marginTop: 8 }}>{r.whyNot}</p>)}
        </div>
      ))}
      {answered.length > 0 && (
        <details style={{ borderTop: "1px solid var(--border)" }}>
          <summary className="pl-sum">Answered in the last 14 days ({answered.length})</summary>
          {answered.map((r) => (
            <div className="pl-req" key={r.id} style={{ borderTop: "1px solid var(--border)" }}>
              <div><b>{nameOf(r.person)}</b>: {r.grant}</div>
              <div className="pl-small">
                {r.state === "approved" ? "Approved" : "Declined"} {day(r.answeredAt)}{r.by ? ` by ${r.by}` : ""}{r.note ? `: "${r.note}"` : ""}{r.undone ? " · undone" : ""}
              </div>
              {rowErr[r.id] && <p className="pl-note pl-err" role="alert" style={{ marginTop: 8 }}>{rowErr[r.id]}</p>}
              {manage && r.state === "approved" && r.changeId && !r.undone && (
                <button className="pl-btn" style={{ marginTop: 8 }} disabled={busy === r.id} onClick={() => undo(r)}>Undo</button>
              )}
            </div>
          ))}
        </details>
      )}
    </section>
  );
}
