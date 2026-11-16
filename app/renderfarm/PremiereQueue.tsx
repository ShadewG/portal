"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";

/**
 * Premiere renders queue (owner, 16 Nov 2026): queue Premiere projects by name, change the order freely, and let the
 * PC download the next ones while After Effects renders. Data: /api/renderfarm/premiere (premiere-farm service).
 */

type Progress = { phase?: string; pct?: number | null; done_gb?: number; total_gb?: number; mbps?: number; elapsed_min?: number; out_gb?: number };
type PJob = {
  job: string;
  title: string;
  project: string;
  episode_folder?: string | null;
  sequence?: string | null;
  other_sequences: { name: string; minutes?: number }[];
  preset: string;
  state: string;
  label: string;
  held: boolean;
  note: string;
  gb?: number | null;
  minutes?: number | null;
  blockers: string[];
  warnings: string[];
  verdict?: string | null;
  added?: string | null;
  added_by?: string | null;
  updated?: string | null;
  render_minutes?: number | null;
  delivered_to?: string | null;
  review_url?: string | null;
  progress: Progress;
  working: boolean;
};
type Found = { path: string; name: string; folder: string; modified?: string | null; size?: number; autosave: boolean; old: boolean; queued_as?: string | null };
type Data = { jobs: PJob[]; presets: { id: string; label: string }[]; lanes: Record<string, string>; viewer?: { canControl: boolean }; error?: string };

const DONE = new Set(["delivered", "cleaned"]);
const REFRESH_MS = 5000;

const card: CSSProperties = { background: "var(--bg-surface)", border: "1px solid var(--border)", padding: 16 };
const label: CSSProperties = { fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--text-muted)", margin: "0 0 10px" };
const btn = (tone: "normal" | "danger" | "primary" = "normal", small = false): CSSProperties => ({
  fontSize: small ? 10 : 11,
  fontWeight: 600,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  padding: small ? "3px 7px" : "7px 12px",
  cursor: "pointer",
  fontFamily: "inherit",
  background: tone === "primary" ? "var(--accent)" : "transparent",
  color: tone === "danger" ? "var(--red)" : tone === "primary" ? "#fff" : "var(--text)",
  border: `1px solid ${tone === "danger" ? "var(--red)" : tone === "primary" ? "var(--accent)" : "var(--border-bright)"}`,
  whiteSpace: "nowrap",
});
const input: CSSProperties = { background: "var(--bg)", color: "var(--text)", border: "1px solid var(--border-bright)", padding: "7px 10px", fontFamily: "inherit", fontSize: 13 };

function tone(j: PJob): string {
  if (j.held) return "var(--text-muted)";
  if (j.state === "failed") return "var(--red)";
  if (j.state === "needs_attention") return "var(--amber)";
  if (j.state === "rendering" || j.state === "syncing") return "var(--green)";
  if (DONE.has(j.state)) return "var(--text-dim)";
  return "var(--accent)";
}

function ago(ts?: string | null): string {
  if (!ts) return "";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "";
  const s = Math.max(0, Math.round((Date.now() - d.getTime()) / 1000));
  if (s < 90) return "just now";
  if (s < 5400) return `${Math.round(s / 60)} min ago`;
  if (s < 129600) return `${Math.round(s / 3600)} h ago`;
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

function folderLabel(folder?: string | null): string {
  if (!folder) return "";
  const parts = folder.split("/").filter(Boolean);
  // "/Insanity/Video/2 Ayoub/IB59 - Alexis.../0 PREMIERE PROJECTS" -> "2 Ayoub / IB59 - Alexis..."
  const skip = parts[0] === "Insanity" ? (parts[1] === "Video" ? 2 : 1) : 0;
  return parts.slice(skip).filter((p) => !/^0 PREMIERE PROJECTS$/i.test(p)).join(" / ");
}

function progressText(j: PJob): string {
  const p = j.progress || {};
  if (j.state === "syncing" && p.total_gb) return `${p.done_gb ?? 0} of ${p.total_gb} GB${p.mbps ? ` · ${p.mbps} Mbit/s` : ""}`;
  if (j.state === "rendering" && p.phase) return `${p.phase}${p.elapsed_min ? ` · ${p.elapsed_min} min` : ""}${p.out_gb ? ` · ${p.out_gb} GB written` : ""}`;
  return "";
}

export default function PremiereQueue() {
  const [data, setData] = useState<Data | null>(null);
  const [jobs, setJobs] = useState<PJob[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [confirmRemove, setConfirmRemove] = useState<string[] | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const dragging = useRef(false);
  const pendingOrder = useRef<number>(0);

  // add panel
  const [adding, setAdding] = useState(false);
  const [q, setQ] = useState("");
  const [found, setFound] = useState<Found[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [showOld, setShowOld] = useState(false);
  const [preset, setPreset] = useState("insanity");
  const [position, setPosition] = useState<"bottom" | "top">("bottom");
  const [paste, setPaste] = useState("");

  const canControl = data?.viewer?.canControl === true;

  const load = useCallback(async () => {
    if (dragging.current || Date.now() < pendingOrder.current) return;
    try {
      const res = await fetch("/api/renderfarm/premiere?op=jobs", { cache: "no-store" });
      const body = (await res.json()) as Data;
      if (!res.ok) return setError(body.error || `HTTP ${res.status}`);
      if (dragging.current || Date.now() < pendingOrder.current) return;
      setData(body);
      setJobs(body.jobs);
      setError(null);
    } catch {
      setError("Could not reach the Premiere queue");
    }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(load, REFRESH_MS);
    return () => clearInterval(t);
  }, [load]);

  // search Dropbox as you type
  useEffect(() => {
    if (!adding) return;
    const term = q.trim();
    if (term.length < 2) {
      setFound(null);
      return;
    }
    const ctl = new AbortController();
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(`/api/renderfarm/premiere?op=search&q=${encodeURIComponent(term)}`, { signal: ctl.signal, cache: "no-store" });
        const body = (await res.json()) as { results?: Found[]; error?: string };
        if (!res.ok) setNotice({ ok: false, text: body.error || `Search failed (HTTP ${res.status})` });
        else setFound(body.results || []);
      } catch {
        /* aborted or offline */
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => {
      clearTimeout(t);
      ctl.abort();
    };
  }, [q, adding]);

  const active = useMemo(() => jobs.filter((j) => !DONE.has(j.state)), [jobs]);
  const done = useMemo(() => jobs.filter((j) => DONE.has(j.state)).sort((a, b) => String(b.updated || "").localeCompare(String(a.updated || ""))), [jobs]);
  const visibleFound = useMemo(() => (found || []).filter((f) => showOld || (!f.autosave && !f.old)), [found, showOld]);
  const hiddenCount = (found?.length || 0) - visibleFound.length;

  async function post(payload: object, key: string, okText?: string): Promise<boolean> {
    setBusy(key);
    setNotice(null);
    try {
      const res = await fetch("/api/renderfarm/premiere", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const body = (await res.json().catch(() => ({}))) as { error?: string; added?: string[]; skipped?: { project: string; why: string }[] };
      if (!res.ok) {
        setNotice({ ok: false, text: body.error || `HTTP ${res.status}` });
        return false;
      }
      if (body.added) {
        const sk = body.skipped || [];
        setNotice({ ok: true, text: `Added ${body.added.length} to the queue${sk.length ? ` · skipped ${sk.length} (${sk.map((s) => s.why).filter((v, i, a) => a.indexOf(v) === i).join(", ")})` : ""}` });
      } else if (okText) setNotice({ ok: true, text: okText });
      return true;
    } catch {
      setNotice({ ok: false, text: "Request failed" });
      return false;
    } finally {
      setBusy(null);
      pendingOrder.current = 0;
      void load();
    }
  }

  const action = (job: string, a: string, value?: string) => post({ op: "action", job, action: a, value }, `${a}:${job}`);

  /** New order for the waiting/active jobs; done jobs keep their place after them. */
  function commitOrder(ids: string[]) {
    const byId = new Map(jobs.map((j) => [j.job, j]));
    const next = [...ids.map((id) => byId.get(id)!).filter(Boolean), ...jobs.filter((j) => !ids.includes(j.job))];
    setJobs(next);
    pendingOrder.current = Date.now() + 8000; // don't let a poll in flight put the old order back
    void post({ op: "reorder", order: next.map((j) => j.job) }, "reorder");
  }

  function move(id: string, to: number) {
    const ids = active.map((j) => j.job);
    const from = ids.indexOf(id);
    if (from < 0) return;
    const clamped = Math.max(0, Math.min(ids.length - 1, to));
    if (clamped === from) return;
    ids.splice(from, 1);
    ids.splice(clamped, 0, id);
    commitOrder(ids);
  }

  function moveMany(sel: string[], where: "top" | "bottom") {
    const ids = active.map((j) => j.job);
    const picked = ids.filter((i) => sel.includes(i));
    const rest = ids.filter((i) => !sel.includes(i));
    commitOrder(where === "top" ? [...picked, ...rest] : [...rest, ...picked]);
  }

  async function bulk(a: "hold" | "resume" | "remove", sel: string[]) {
    for (const id of sel) {
      // one by one so a refusal (e.g. "it is downloading right now") is shown for that job
      await post({ op: "action", job: id, action: a }, `${a}:${id}`);
    }
    if (a === "remove") setSelected(new Set());
  }

  async function addPicked() {
    const projects = [...picked, ...paste.split(/\r?\n/).map((s) => s.trim()).filter((s) => s.startsWith("/") && /\.prproj$/i.test(s))];
    if (!projects.length) return setNotice({ ok: false, text: "Pick at least one project (or paste a Dropbox path to a .prproj)" });
    const ok = await post({ op: "add", projects, preset, position }, "add");
    if (ok) {
      setPicked(new Set());
      setPaste("");
    }
  }

  function onRowKey(e: KeyboardEvent<HTMLDivElement>, id: string, idx: number) {
    if (!canControl) return;
    if (e.altKey && e.key === "ArrowUp") { e.preventDefault(); move(id, idx - 1); }
    else if (e.altKey && e.key === "ArrowDown") { e.preventDefault(); move(id, idx + 1); }
    else if (e.key === " " && e.target === e.currentTarget) { e.preventDefault(); toggle(setSelected, id); }
  }

  const selList = [...selected].filter((id) => active.some((j) => j.job === id));
  const lanes = data?.lanes || {};

  return (
    <section style={card}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
        <p style={{ ...label, margin: 0 }}>Premiere renders</p>
        <span style={{ fontSize: 11, color: "var(--text-dim)" }}>
          {active.length ? `${active.length} in the queue` : "queue is empty"}
          {lanes.sync ? " · downloading" : ""}
          {lanes.render ? " · rendering" : ""}
          {lanes.finish ? " · uploading" : ""}
        </span>
        <span style={{ fontSize: 11, color: "var(--text-muted)" }}>After Effects always renders first; downloads run alongside it.</span>
        {canControl && (
          <button style={{ ...btn(adding ? "normal" : "primary"), marginLeft: "auto" }} onClick={() => setAdding((v) => !v)}>
            {adding ? "Close" : "+ Add projects"}
          </button>
        )}
      </div>

      {error && <p style={{ color: "var(--red)", fontSize: 12, margin: "0 0 8px" }}>▲ {error}</p>}
      {notice && <p style={{ color: notice.ok ? "var(--green)" : "var(--red)", fontSize: 12, margin: "0 0 8px" }}>{notice.text}</p>}

      {adding && canControl && (
        <div style={{ border: "1px solid var(--border)", padding: 12, marginBottom: 12, display: "grid", gap: 10 }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search Premiere projects by name — IB57, Tubi, MERGE…"
              style={{ ...input, flex: "1 1 260px", minWidth: 0 }}
            />
            <select value={preset} onChange={(e) => setPreset(e.target.value)} style={input} title="Export settings">
              {(data?.presets || []).map((p) => (
                <option key={p.id} value={p.id}>{p.label}</option>
              ))}
            </select>
            <select value={position} onChange={(e) => setPosition(e.target.value as "top" | "bottom")} style={input} title="Where new projects go">
              <option value="bottom">Add to the end</option>
              <option value="top">Add to the top</option>
            </select>
          </div>

          {searching && <p style={{ margin: 0, fontSize: 12, color: "var(--text-dim)" }}>Searching Dropbox…</p>}
          {found && !searching && (
            <div style={{ display: "grid", gap: 2, maxHeight: 340, overflowY: "auto" }}>
              {visibleFound.length === 0 && <p style={{ margin: 0, fontSize: 12, color: "var(--text-dim)" }}>No projects found{hiddenCount ? " (some old copies and auto-saves are hidden)" : ""}.</p>}
              {visibleFound.length > 1 && (
                <label style={{ fontSize: 11, color: "var(--text-dim)", display: "flex", gap: 6, alignItems: "center", padding: "2px 4px" }}>
                  <input
                    type="checkbox"
                    checked={visibleFound.filter((f) => !f.queued_as).every((f) => picked.has(f.path))}
                    onChange={(e) =>
                      setPicked((s) => {
                        const n = new Set(s);
                        for (const f of visibleFound) if (!f.queued_as) (e.target.checked ? n.add(f.path) : n.delete(f.path));
                        return n;
                      })
                    }
                  />
                  Select all shown
                </label>
              )}
              {visibleFound.map((f) => (
                <label key={f.path} style={{ display: "flex", gap: 8, alignItems: "flex-start", padding: "5px 4px", borderTop: "1px solid var(--border)", opacity: f.queued_as ? 0.55 : 1, cursor: f.queued_as ? "default" : "pointer" }}>
                  <input type="checkbox" disabled={!!f.queued_as} checked={picked.has(f.path)} onChange={() => toggle(setPicked, f.path)} style={{ marginTop: 3 }} />
                  <span style={{ minWidth: 0, flex: 1 }}>
                    <span style={{ fontSize: 13, fontWeight: 600, wordBreak: "break-word" }}>{f.name}</span>
                    {f.queued_as && <span style={{ fontSize: 10, color: "var(--green)", marginLeft: 8 }}>IN QUEUE</span>}
                    {(f.autosave || f.old) && <span style={{ fontSize: 10, color: "var(--amber)", marginLeft: 8 }}>{f.autosave ? "AUTO-SAVE" : "OLD COPY"}</span>}
                    <span style={{ display: "block", fontSize: 11, color: "var(--text-dim)", wordBreak: "break-word" }}>
                      {folderLabel(f.folder)} · saved {ago(f.modified)}
                    </span>
                  </span>
                </label>
              ))}
              {hiddenCount > 0 && (
                <button style={{ ...btn("normal", true), justifySelf: "start", marginTop: 4 }} onClick={() => setShowOld((v) => !v)}>
                  {showOld ? "Hide old copies and auto-saves" : `Show ${hiddenCount} old copies and auto-saves`}
                </button>
              )}
            </div>
          )}

          <details>
            <summary style={{ fontSize: 11, color: "var(--text-dim)", cursor: "pointer" }}>Or paste Dropbox paths (one per line)</summary>
            <textarea value={paste} onChange={(e) => setPaste(e.target.value)} rows={3} placeholder="/Insanity/Video/…/0 PREMIERE PROJECTS/…prproj" style={{ ...input, width: "100%", marginTop: 6, boxSizing: "border-box" }} />
          </details>

          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <button style={btn("primary")} disabled={busy === "add"} onClick={addPicked}>
              {busy === "add" ? "Adding…" : `Add ${picked.size + paste.split(/\r?\n/).filter((s) => /\.prproj$/i.test(s.trim())).length || ""} to the queue`}
            </button>
            {picked.size > 0 && (
              <button style={btn()} onClick={() => setPicked(new Set())}>Clear selection</button>
            )}
            <span style={{ fontSize: 11, color: "var(--text-muted)" }}>Each project is read first; anything that would stop or change the render is listed for a decision.</span>
          </div>
        </div>
      )}

      {canControl && selList.length > 0 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginBottom: 8, padding: "6px 8px", border: "1px solid var(--border)" }}>
          <span style={{ fontSize: 11, color: "var(--text-dim)" }}>{selList.length} selected</span>
          <button style={btn("normal", true)} onClick={() => moveMany(selList, "top")}>Move to top</button>
          <button style={btn("normal", true)} onClick={() => moveMany(selList, "bottom")}>Move to end</button>
          <button style={btn("normal", true)} onClick={() => bulk("hold", selList)}>Hold</button>
          <button style={btn("normal", true)} onClick={() => bulk("resume", selList)}>Resume</button>
          {confirmRemove ? (
            <>
              <span style={{ fontSize: 11, color: "var(--red)" }}>Remove {confirmRemove.length} and delete their files on the PC?</span>
              <button style={btn("danger", true)} onClick={() => { const r = confirmRemove; setConfirmRemove(null); void bulk("remove", r); }}>Yes, remove</button>
              <button style={btn("normal", true)} onClick={() => setConfirmRemove(null)}>No</button>
            </>
          ) : (
            <button style={btn("danger", true)} onClick={() => setConfirmRemove(selList)}>Remove</button>
          )}
          <button style={{ ...btn("normal", true), marginLeft: "auto" }} onClick={() => setSelected(new Set())}>Clear</button>
        </div>
      )}

      {!data && !error && <p style={{ margin: 0, fontSize: 13, color: "var(--text-dim)" }}>Loading the Premiere queue…</p>}
      {data && active.length === 0 && <p style={{ margin: 0, fontSize: 13, color: "var(--text-dim)" }}>Nothing waiting.{canControl ? " Use + Add projects to queue Premiere renders." : ""}</p>}

      <div style={{ display: "grid", gap: 4 }} onDragEnd={() => { dragging.current = false; setDragId(null); setOverId(null); }}>
        {active.map((j, idx) => {
          const isOpen = open.has(j.job);
          const pct = j.progress?.pct;
          const showBar = (j.state === "syncing" || j.state === "rendering") && typeof pct === "number";
          return (
            <div
              key={j.job}
              tabIndex={0}
              onKeyDown={(e) => onRowKey(e, j.job, idx)}
              draggable={canControl}
              onDragStart={(e) => { dragging.current = true; setDragId(j.job); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", j.job); }}
              onDragOver={(e) => { if (!dragId) return; e.preventDefault(); if (overId !== j.job) setOverId(j.job); }}
              onDrop={(e) => { e.preventDefault(); const id = dragId; dragging.current = false; setDragId(null); setOverId(null); if (id && id !== j.job) move(id, idx); }}
              style={{
                border: "1px solid var(--border)",
                borderTop: overId === j.job && dragId && dragId !== j.job ? "2px solid var(--accent)" : "1px solid var(--border)",
                background: selected.has(j.job) ? "var(--bg-hover, rgba(127,127,127,0.08))" : "var(--bg)",
                opacity: dragId === j.job ? 0.5 : j.held ? 0.7 : 1,
                padding: "8px 10px",
                outline: "none",
              }}
            >
              <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                {canControl && (
                  <span title="Drag to reorder (or Alt+↑ / Alt+↓)" style={{ cursor: "grab", color: "var(--text-muted)", fontSize: 14, userSelect: "none" }}>⠿</span>
                )}
                {canControl && <input type="checkbox" checked={selected.has(j.job)} onChange={() => toggle(setSelected, j.job)} aria-label={`Select ${j.title}`} />}
                <span style={{ fontSize: 12, color: "var(--text-muted)", width: 20, textAlign: "right" }}>{idx + 1}</span>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: tone(j), flex: "none" }} />
                <button onClick={() => toggle(setOpen, j.job)} style={{ background: "none", border: "none", padding: 0, color: "var(--text)", textAlign: "left", cursor: "pointer", fontFamily: "inherit", minWidth: 0, flex: "1 1 220px" }}>
                  <span style={{ fontSize: 13, fontWeight: 600, wordBreak: "break-word" }}>{j.title.replace(/\.prproj$/i, "")}</span>
                  <span style={{ display: "block", fontSize: 11, color: "var(--text-dim)" }}>
                    {j.held ? "On hold · " : ""}
                    {j.label}
                    {j.blockers.length ? ` · ${j.blockers.length} to decide` : ""}
                    {j.minutes ? ` · ${Math.round(j.minutes)} min` : ""}
                    {j.gb ? ` · ${j.gb.toFixed(0)} GB` : ""}
                    {progressText(j) ? ` · ${progressText(j)}` : ""}
                  </span>
                </button>
                {canControl && (
                  <span style={{ display: "inline-flex", gap: 4, flexWrap: "wrap" }}>
                    <button style={btn("normal", true)} title="Move up" disabled={idx === 0} onClick={() => move(j.job, idx - 1)}>↑</button>
                    <button style={btn("normal", true)} title="Move down" disabled={idx === active.length - 1} onClick={() => move(j.job, idx + 1)}>↓</button>
                    <button style={btn("normal", true)} title="Move to the top" disabled={idx === 0} onClick={() => move(j.job, 0)}>Top</button>
                    {j.state === "needs_attention" && (
                      <button style={btn("primary", true)} disabled={!!busy} onClick={() => action(j.job, "approve")} title="Render it anyway with what is listed">Approve</button>
                    )}
                    {j.state === "failed" && <button style={btn("primary", true)} disabled={!!busy} onClick={() => action(j.job, "retry")}>Retry</button>}
                    <button style={btn("normal", true)} disabled={!!busy} onClick={() => action(j.job, j.held ? "resume" : "hold")}>{j.held ? "Resume" : "Hold"}</button>
                  </span>
                )}
              </div>
              {showBar && (
                <div style={{ height: 3, background: "var(--border)", marginTop: 6 }}>
                  <div style={{ height: 3, width: `${Math.max(2, Math.min(100, pct || 0))}%`, background: "var(--green)", transition: "width .5s" }} />
                </div>
              )}
              {isOpen && (
                <div style={{ marginTop: 8, paddingLeft: canControl ? 50 : 30, display: "grid", gap: 6, fontSize: 12 }}>
                  <div style={{ color: "var(--text-dim)", wordBreak: "break-word" }}>{j.project}</div>
                  {j.note && <div style={{ color: "var(--text-dim)" }}>{j.note}</div>}
                  {j.blockers.length > 0 && (
                    <div>
                      <div style={{ ...label, margin: "4px 0", color: "var(--amber)" }}>Would stop or change the render</div>
                      <ul style={{ margin: 0, paddingLeft: 18 }}>{j.blockers.map((b, i) => <li key={i}>{b}</li>)}</ul>
                    </div>
                  )}
                  {j.warnings.length > 0 && (
                    <div>
                      <div style={{ ...label, margin: "4px 0" }}>Notes</div>
                      <ul style={{ margin: 0, paddingLeft: 18, color: "var(--text-dim)" }}>{j.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
                    </div>
                  )}
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                    {j.sequence && <span style={{ color: "var(--text-dim)" }}>Sequence: <b style={{ color: "var(--text)" }}>{j.sequence}</b></span>}
                    {canControl && j.other_sequences.length > 0 && !["syncing", "rendering", "rendered", "compared"].includes(j.state) && (
                      <select style={{ ...input, fontSize: 11, padding: "3px 6px" }} value="" onChange={(e) => e.target.value && void action(j.job, "sequence", e.target.value)}>
                        <option value="">Render another sequence…</option>
                        {j.other_sequences.map((s) => <option key={s.name} value={s.name}>{s.name}{s.minutes ? ` (${Math.round(s.minutes)} min)` : ""}</option>)}
                      </select>
                    )}
                    {canControl && !["rendering", "rendered", "compared"].includes(j.state) ? (
                      <select style={{ ...input, fontSize: 11, padding: "3px 6px" }} value={j.preset} onChange={(e) => void action(j.job, "preset", e.target.value)} title="Export settings">
                        {(data?.presets || []).map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                      </select>
                    ) : (
                      <span style={{ color: "var(--text-dim)" }}>{(data?.presets || []).find((p) => p.id === j.preset)?.label || j.preset}</span>
                    )}
                    {canControl && (confirmRemove?.length === 1 && confirmRemove[0] === j.job ? (
                      <>
                        <span style={{ color: "var(--red)" }}>Remove and delete its files on the PC?</span>
                        <button style={btn("danger", true)} onClick={() => { setConfirmRemove(null); void action(j.job, "remove"); }}>Yes</button>
                        <button style={btn("normal", true)} onClick={() => setConfirmRemove(null)}>No</button>
                      </>
                    ) : (
                      <button style={btn("danger", true)} onClick={() => setConfirmRemove([j.job])}>Remove</button>
                    ))}
                  </div>
                  <div style={{ color: "var(--text-muted)", fontSize: 11 }}>Added {ago(j.added)}{j.added_by ? ` by ${j.added_by}` : ""}</div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {done.length > 0 && (
        <details style={{ marginTop: 12 }}>
          <summary style={{ ...label, margin: 0, cursor: "pointer" }}>Done ({done.length})</summary>
          <div style={{ display: "grid", gap: 4, marginTop: 8 }}>
            {done.slice(0, 30).map((j) => (
              <div key={j.job} style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", padding: "6px 10px", border: "1px solid var(--border)" }}>
                <span style={{ fontSize: 13, fontWeight: 600, flex: "1 1 220px", minWidth: 0, wordBreak: "break-word" }}>
                  {j.title.replace(/\.prproj$/i, "")}
                  <span style={{ display: "block", fontSize: 11, color: "var(--text-dim)", fontWeight: 400 }}>
                    {j.render_minutes ? `rendered in ${j.render_minutes} min · ` : ""}
                    {j.verdict ? `vs the final: ${j.verdict} · ` : ""}
                    {ago(j.updated)}
                  </span>
                </span>
                {j.review_url && (
                  <a href={j.review_url} target="_blank" rel="noopener noreferrer" style={{ ...btn("normal", true), textDecoration: "none" }}>Review</a>
                )}
              </div>
            ))}
          </div>
        </details>
      )}
    </section>
  );
}

function toggle(set: (fn: (s: Set<string>) => Set<string>) => void, id: string) {
  set((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    return n;
  });
}
