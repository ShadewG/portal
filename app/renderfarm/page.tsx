"use client";

import { useCallback, useEffect, useState, type CSSProperties } from "react";

const REFRESH_MS = 5000;

type Progress = { totalFrames: number | null; frame: number | null; percent: number | null; finished: boolean };
type Current = {
  kind: string;
  name: string;
  pageId: string;
  startedAt: string;
  stage: string;
  comp: string;
  format?: string;
  progress: Progress | null;
  elapsedSeconds: number;
};
type Card = { pageId: string; name: string; kind: string; status: string; format: string; episode: string; lastEdited: string; notionUrl: string; reason?: string };
type HistoryRow = { timestamp: string; type: string; label: string; name: string; kind: string; episode: string; detail: string };
type Check = { level: string; message: string; fix?: string };
type Controls = { canControl: boolean; state: string; maintenance: boolean; paused: boolean };
type Host = { checkedAt: string | null; ramFreeGB?: number; ramTotalGB?: number; aeMemGB?: number; disks?: { drive: string; freeGB: number; totalGB: number }[]; error?: string };
type Live = {
  generatedAt: string;
  overall: string;
  heartbeatAgeSeconds: number | null;
  controls: Controls;
  current: Current | null;
  queue: { checkedAt: string | null; errors: { episode: string; error: string }[]; rows: Card[] };
  failed: Card[];
  history: HistoryRow[];
  checks: Check[];
  host: Host;
  error?: string;
};

const STAGES: Record<string, string> = {
  starting: "Starting",
  start: "Starting",
  "download-aep": "Downloading project",
  "scan-deps": "Scanning footage",
  "fetch-deps": "Downloading footage",
  "reroute-footage": "Finding moved footage",
  relink: "Linking footage",
  "detect-comp": "Finding comp",
  render: "Rendering",
  upload: "Uploading to Dropbox",
};

/** Failure text from the farm log, minus the card prefix and the trailing episode tag. */
function reasonText(detail: string): string {
  return detail.replace(/^\[[^\]]*\]\s+'[^']*'\s*/, "").replace(/\s+episode=\S+\s*$/, "");
}

/** Dropbox path of a delivered render, from a DONE line ("… -> /Insanity/…/file.mp4 episode=…"). */
function deliveredPath(detail: string): string | null {
  const m = String(detail || "").match(/-> (\/Insanity\/.+?\.(?:mp4|mov))(?=\s|$)/i);
  return m ? m[1] : null;
}
type Render = { path: string; name: string; episode: string; kind: string; timestamp: string; alpha: boolean };
const fileName = (p: string) => p.split("/").pop() || p;

function fmtDuration(s: number | null | undefined): string {
  if (s == null) return "—";
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}
function fmtTime(ts: string): string {
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? ts : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
function fmtDay(ts: string): string {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "";
  const today = new Date().toDateString() === d.toDateString();
  return today ? fmtTime(ts) : `${d.toLocaleDateString([], { month: "short", day: "numeric" })} ${fmtTime(ts)}`;
}

const card: CSSProperties = { background: "var(--bg-surface)", border: "1px solid var(--border)", padding: 16 };
const label: CSSProperties = { fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--text-muted)", margin: "0 0 10px" };
const btn = (tone: "normal" | "danger" | "primary" = "normal"): CSSProperties => ({
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  padding: "7px 12px",
  cursor: "pointer",
  fontFamily: "inherit",
  background: tone === "primary" ? "var(--accent)" : "transparent",
  color: tone === "danger" ? "var(--red)" : tone === "primary" ? "#fff" : "var(--text)",
  border: `1px solid ${tone === "danger" ? "var(--red)" : tone === "primary" ? "var(--accent)" : "var(--border-bright)"}`,
});

function stateTone(state: string): string {
  if (state === "Running") return "var(--green)";
  if (state === "Maintenance" || state === "Stopped") return "var(--red)";
  return "var(--amber)";
}

export default function RenderFarmPage() {
  const [data, setData] = useState<Live | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [lastOk, setLastOk] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [playing, setPlaying] = useState<Render | null>(null);
  const closePlayer = useCallback(() => setPlaying(null), []);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/renderfarm/live", { cache: "no-store" });
      if (res.status === 403) return setForbidden(true);
      const body = (await res.json()) as Live;
      if (!res.ok) {
        setError(body.error || `HTTP ${res.status}`);
        return;
      }
      setData(body);
      setError(null);
      setLastOk(Date.now());
    } catch {
      setError("Could not reach the portal");
    }
  }, []);

  useEffect(() => {
    void load();
    const poll = setInterval(load, REFRESH_MS);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      clearInterval(poll);
      clearInterval(tick);
    };
  }, [load]);

  async function post(path: string, payload: object, key: string) {
    setBusy(key);
    setConfirm(null);
    setNotice(null);
    try {
      const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const body = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
      setNotice({ ok: res.ok, text: res.ok ? body.message || "Done" : body.error || `HTTP ${res.status}` });
      await load();
    } catch {
      setNotice({ ok: false, text: "Request failed" });
    } finally {
      setBusy(null);
    }
  }
  const control = (action: string) => post("/api/renderfarm/control", { action }, action);
  const requeue = (c: Card) => post("/api/renderfarm/requeue", { pageId: c.pageId, kind: c.kind }, `rq:${c.pageId}:${c.kind}`);

  const stale = lastOk != null && now - lastOk > 30_000;
  const state = data?.controls.state ?? "—";
  const cur = data?.current ?? null;
  const pct = cur?.progress?.percent ?? null;
  // Newest first, one tile per delivered file (a card rendered twice lands as _v2, a new path).
  const renders: Render[] = [];
  for (const h of data?.history ?? []) {
    const p = h.type === "DONE" ? deliveredPath(h.detail) : null;
    if (p && !renders.some((r) => r.path === p)) renders.push({ path: p, name: h.name, episode: h.episode, kind: h.kind, timestamp: h.timestamp, alpha: /\.mov$/i.test(p) });
  }

  function ControlButton({ action, text, tone = "normal", guarded = false }: { action: string; text: string; tone?: "normal" | "danger" | "primary"; guarded?: boolean }) {
    const disabled = !!busy || !data?.controls.canControl;
    if (guarded && confirm === action) {
      return (
        <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
          <span style={{ fontSize: 11, color: "var(--text-dim)" }}>{text}?</span>
          <button style={btn("danger")} disabled={disabled} onClick={() => control(action)}>Yes</button>
          <button style={btn()} onClick={() => setConfirm(null)}>No</button>
        </span>
      );
    }
    return (
      <button style={{ ...btn(tone), opacity: disabled ? 0.5 : 1 }} disabled={disabled} onClick={() => (guarded ? setConfirm(action) : control(action))}>
        {busy === action ? "…" : text}
      </button>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)" }}>
      <header style={{ borderBottom: "1px solid var(--border)", padding: "14px 16px", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <a href="/" style={{ color: "var(--text-dim)", textDecoration: "none", fontSize: 18 }}>⌘</a>
        <span style={{ color: "var(--border)" }}>/</span>
        <h1 style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.15em", textTransform: "uppercase", margin: 0 }}>Render Farm</h1>
        {data && (
          <span style={{ marginLeft: "auto", fontSize: 11, color: stale || error ? "var(--red)" : "var(--text-muted)" }}>
            {error ? `▲ ${error}` : stale ? `▲ No update for ${fmtDuration(Math.round((now - (lastOk ?? now)) / 1000))}` : `Live · updated ${fmtTime(data.generatedAt)}`}
          </span>
        )}
      </header>

      <main style={{ maxWidth: 1180, margin: "0 auto", padding: "24px 16px 48px", display: "grid", gap: 16 }}>
        {forbidden && <p style={{ color: "var(--text-dim)" }}>You do not have access to the Render Farm. Ask Samuel to grant it in Portal admin.</p>}
        {!forbidden && !data && !error && <p style={{ color: "var(--text-dim)" }}>Connecting to the render farm…</p>}
        {!forbidden && !data && error && <p style={{ color: "var(--red)" }}>{error}</p>}
        {playing && <Player r={playing} onClose={closePlayer} />}

        {data && (
          <>
            {/* Status + controls */}
            <section style={{ ...card, display: "flex", flexWrap: "wrap", gap: 20, alignItems: "center" }}>
              <div style={{ minWidth: 180 }}>
                <p style={label}>Farm</p>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ width: 9, height: 9, borderRadius: "50%", background: stateTone(state) }} />
                  <span style={{ fontSize: 20, fontWeight: 700 }}>{state}</span>
                </div>
                <div style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 4 }}>
                  {data.overall} · heartbeat {fmtDuration(data.heartbeatAgeSeconds)} ago
                  {(data.heartbeatAgeSeconds ?? 0) > 120 && state === "Running" && <span style={{ color: "var(--red)" }}> — poller may be stuck</span>}
                </div>
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginLeft: "auto" }}>
                {state === "Maintenance" ? (
                  <ControlButton action="Resume" text="End maintenance" tone="primary" />
                ) : state === "Running" || state === "Finishing current render" ? (
                  <>
                    {!data.controls.paused && <ControlButton action="Pause" text="Pause after current" />}
                    {!cur && <ControlButton action="Stop" text="Stop farm" tone="danger" guarded />}
                    <ControlButton action="Maintenance" text="Maintenance" tone="danger" guarded />
                  </>
                ) : (
                  <>
                    <ControlButton action="Start" text="Start farm" tone="primary" />
                    <ControlButton action="Maintenance" text="Maintenance" tone="danger" guarded />
                  </>
                )}
              </div>
              {!data.controls.canControl && (
                <p style={{ width: "100%", margin: 0, fontSize: 11, color: "var(--amber)" }}>Controls are disabled: this machine is not the primary render node.</p>
              )}
              {notice && <p style={{ width: "100%", margin: 0, fontSize: 12, color: notice.ok ? "var(--green)" : "var(--red)" }}>{notice.text}</p>}
            </section>

            {/* Now rendering */}
            <section style={card}>
              <p style={label}>Now rendering</p>
              {!cur ? (
                <p style={{ margin: 0, color: "var(--text-dim)", fontSize: 13 }}>Idle{data.queue.rows.length ? ` — ${data.queue.rows.length} card(s) waiting` : " — queue is empty"}</p>
              ) : (
                <div style={{ display: "grid", gap: 10 }}>
                  <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "baseline" }}>
                    <span style={{ fontSize: 17, fontWeight: 700, wordBreak: "break-all" }}>{cur.name}</span>
                    <span style={{ fontSize: 11, color: "var(--text-dim)" }}>{cur.kind}{cur.format ? ` · ${cur.format}` : ""}</span>
                    <span style={{ marginLeft: "auto" }}>
                      <ControlButton action="Abort" text="Stop this render" tone="danger" guarded />
                    </span>
                  </div>
                  <div style={{ fontSize: 12, color: "var(--text-dim)" }}>
                    {STAGES[cur.stage] || cur.stage} · running {fmtDuration(cur.elapsedSeconds)}
                    {cur.comp && <> · <span style={{ wordBreak: "break-all" }}>{cur.comp}</span></>}
                  </div>
                  {cur.stage === "render" && (
                    <div>
                      <div style={{ height: 8, background: "var(--bg-elevated)", border: "1px solid var(--border)" }}>
                        <div style={{ height: "100%", width: `${pct ?? 0}%`, background: "var(--accent)", transition: "width .6s" }} />
                      </div>
                      <div style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 4 }}>
                        {pct == null ? "Waiting for the first frame…" : `${pct}% · frame ${cur.progress?.frame ?? 0} of ${cur.progress?.totalFrames ?? "?"}`}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </section>

            {/* Recent renders: thumbnails, click to play */}
            {renders.length > 0 && (
              <section style={card}>
                <p style={label}>Recent renders ({renders.length})</p>
                <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 200px), 1fr))" }}>
                  {renders.slice(0, 12).map((r) => (
                    <RenderTile key={r.path} r={r} onPlay={() => setPlaying(r)} />
                  ))}
                </div>
              </section>
            )}

            <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 340px), 1fr))" }}>
              {/* Queue */}
              <section style={card}>
                <p style={label}>Queue ({data.queue.rows.length})</p>
                {data.queue.rows.length === 0 && <p style={{ margin: 0, fontSize: 12, color: "var(--text-dim)" }}>Nothing waiting.</p>}
                <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 6 }}>
                  {data.queue.rows.map((c) => (
                    <li key={`${c.pageId}:${c.kind}`} style={{ fontSize: 12, display: "flex", gap: 8 }}>
                      <span style={{ color: "var(--text-muted)", minWidth: 44 }}>{c.episode}</span>
                      <a href={c.notionUrl} target="_blank" rel="noreferrer" style={{ color: "var(--text)", wordBreak: "break-all" }}>{c.name}</a>
                      <span style={{ marginLeft: "auto", color: "var(--text-dim)" }}>{c.kind === "textless" ? "textless" : c.format}</span>
                    </li>
                  ))}
                </ul>
                {data.queue.errors.map((e) => (
                  <p key={e.episode + e.error} style={{ fontSize: 11, color: "var(--amber)", margin: "8px 0 0" }}>Could not read {e.episode || "a database"}: {e.error}</p>
                ))}
                {data.queue.checkedAt && <p style={{ fontSize: 10, color: "var(--text-muted)", margin: "10px 0 0" }}>Notion checked {fmtTime(data.queue.checkedAt)}</p>}
              </section>

              {/* Failed */}
              <section style={card}>
                <p style={label}>Failed ({data.failed.length})</p>
                {data.failed.length === 0 && <p style={{ margin: 0, fontSize: 12, color: "var(--text-dim)" }}>No failed cards.</p>}
                <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 10 }}>
                  {data.failed.map((c) => {
                    const key = `rq:${c.pageId}:${c.kind}`;
                    return (
                      <li key={key} style={{ fontSize: 12, display: "grid", gap: 4 }}>
                        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                          <span style={{ color: "var(--text-muted)", minWidth: 44 }}>{c.episode}</span>
                          <a href={c.notionUrl} target="_blank" rel="noreferrer" style={{ color: "var(--text)", wordBreak: "break-all" }}>{c.name}</a>
                          <button style={{ ...btn(), marginLeft: "auto", padding: "4px 8px" }} disabled={!!busy} onClick={() => requeue(c)}>
                            {busy === key ? "…" : "Re-queue"}
                          </button>
                        </div>
                        {c.reason && <div style={{ color: "var(--text-dim)", fontSize: 11, paddingLeft: 52, wordBreak: "break-word" }}>{reasonText(c.reason)}</div>}
                      </li>
                    );
                  })}
                </ul>
              </section>
            </div>

            <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 340px), 1fr))" }}>
              {/* Activity */}
              <section style={card}>
                <p style={label}>Recent activity</p>
                <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 6, maxHeight: 420, overflowY: "auto" }}>
                  {data.history.slice(0, 30).map((h, i) => (
                    <li key={i} style={{ fontSize: 12, display: "grid", gridTemplateColumns: "64px 1fr", gap: 8 }}>
                      <span style={{ color: "var(--text-muted)" }}>{fmtDay(h.timestamp)}</span>
                      <span>
                        <span style={{ color: h.type === "FAIL" ? "var(--red)" : h.type === "DONE" ? "var(--green)" : "var(--text-dim)", fontWeight: 600 }}>{h.label}</span>{" "}
                        <span style={{ wordBreak: "break-all" }}>{h.name}</span>
                        {h.type === "DONE" && deliveredPath(h.detail) && (
                          <button
                            style={{ ...btn(), padding: "1px 6px", marginLeft: 6, fontSize: 10 }}
                            onClick={() => { const p = deliveredPath(h.detail)!; setPlaying(renders.find((r) => r.path === p) ?? { path: p, name: h.name, episode: h.episode, kind: h.kind, timestamp: h.timestamp, alpha: /\.mov$/i.test(p) }); }}
                          >
                            ▶ Play
                          </button>
                        )}
                        {h.type === "FAIL" && (
                          <div style={{ color: "var(--text-dim)", fontSize: 11, wordBreak: "break-word" }}>{reasonText(h.detail)}</div>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>

              {/* Machine */}
              <section style={card}>
                <p style={label}>Machine</p>
                {data.host.error && <p style={{ fontSize: 11, color: "var(--amber)" }}>{data.host.error}</p>}
                <div style={{ display: "grid", gap: 8, fontSize: 12 }}>
                  {data.host.ramTotalGB != null && (
                    <Meter name="Memory free" free={data.host.ramFreeGB ?? 0} total={data.host.ramTotalGB} note={data.host.aeMemGB ? `After Effects using ${data.host.aeMemGB} GB` : undefined} />
                  )}
                  {(data.host.disks ?? []).map((d) => (
                    <Meter key={d.drive} name={`Disk ${d.drive} free`} free={d.freeGB} total={d.totalGB} />
                  ))}
                </div>
                <p style={{ ...label, marginTop: 16 }}>Checks</p>
                <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 6 }}>
                  {data.checks.filter((c) => c.level !== "PASS").length === 0 && <li style={{ fontSize: 12, color: "var(--green)" }}>All checks pass</li>}
                  {data.checks
                    .filter((c) => c.level !== "PASS")
                    .map((c, i) => (
                      <li key={i} style={{ fontSize: 12 }}>
                        <span style={{ color: c.level === "FAIL" ? "var(--red)" : "var(--amber)", fontWeight: 700 }}>{c.level}</span> {c.message}
                        {c.fix && <div style={{ fontSize: 11, color: "var(--text-dim)" }}>{c.fix}</div>}
                      </li>
                    ))}
                </ul>
              </section>
            </div>
          </>
        )}
      </main>
    </div>
  );
}

function RenderTile({ r, onPlay }: { r: Render; onPlay: () => void }) {
  const [broken, setBroken] = useState(false);
  return (
    <button
      onClick={onPlay}
      title={r.path}
      style={{ all: "unset", cursor: "pointer", display: "grid", gap: 6, minWidth: 0 }}
    >
      <span style={{ position: "relative", display: "block", aspectRatio: "16 / 9", background: "var(--bg-elevated)", border: "1px solid var(--border)", overflow: "hidden" }}>
        {!broken && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`/api/renderfarm/poster?path=${encodeURIComponent(r.path)}`}
            alt=""
            loading="lazy"
            onError={() => setBroken(true)}
            style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
          />
        )}
        {broken && <span style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", fontSize: 11, color: "var(--text-muted)" }}>No thumbnail</span>}
        <span style={{ position: "absolute", left: 8, bottom: 8, width: 30, height: 30, borderRadius: "50%", background: "rgba(0,0,0,.65)", display: "grid", placeItems: "center", color: "#fff", fontSize: 12 }}>▶</span>
        {r.alpha && <span style={{ position: "absolute", right: 6, top: 6, fontSize: 9, fontWeight: 700, letterSpacing: "0.08em", padding: "2px 5px", background: "rgba(0,0,0,.65)", color: "#fff" }}>ALPHA</span>}
      </span>
      <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{fileName(r.path)}</span>
      <span style={{ fontSize: 11, color: "var(--text-dim)" }}>{r.episode} · {r.kind} · {fmtDay(r.timestamp)}</span>
    </button>
  );
}

/** Plays a delivered render in a window over the page. Alpha renders need a browser copy made first. */
function Player({ r, onClose }: { r: Render; onClose: () => void }) {
  const [media, setMedia] = useState<{ url?: string | null; ready?: boolean; error?: string } | null>(null);
  useEffect(() => {
    let alive = true, timer: ReturnType<typeof setTimeout> | undefined;
    const ask = async () => {
      try {
        const res = await fetch(`/api/renderfarm/media?path=${encodeURIComponent(r.path)}`, { cache: "no-store" });
        const body = (await res.json()) as { url?: string | null; ready?: boolean; error?: string };
        if (!alive) return;
        if (!res.ok) return setMedia({ error: body.error || `HTTP ${res.status}` });
        setMedia(body);
        if (!body.ready && !body.error) timer = setTimeout(ask, 3000);
      } catch {
        if (alive) setMedia({ error: "Could not reach the portal" });
      }
    };
    void ask();
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", esc);
    return () => { alive = false; if (timer) clearTimeout(timer); window.removeEventListener("keydown", esc); };
  }, [r.path, onClose]);

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.8)", zIndex: 50, display: "grid", placeItems: "center", padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ ...card, width: "min(100%, 1100px)", display: "grid", gap: 10 }}>
        <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
          <span style={{ fontSize: 14, fontWeight: 700, wordBreak: "break-all" }}>{fileName(r.path)}</span>
          <span style={{ fontSize: 11, color: "var(--text-dim)" }}>{r.episode} · {r.kind} · {fmtDay(r.timestamp)}</span>
          <button style={{ ...btn(), marginLeft: "auto" }} onClick={onClose}>Close</button>
        </div>
        <div style={{ background: "#000", aspectRatio: "16 / 9", display: "grid", placeItems: "center" }}>
          {media?.ready && media.url ? (
            <video src={media.url} controls autoPlay playsInline style={{ width: "100%", height: "100%", maxHeight: "75vh" }} />
          ) : (
            <span style={{ fontSize: 12, color: media?.error ? "var(--red)" : "var(--text-dim)", padding: 16, textAlign: "center" }}>
              {media?.error ? media.error : r.alpha ? "Making a browser-playable copy of this alpha render (first time only, usually under a minute)…" : "Loading…"}
            </span>
          )}
        </div>
        <div style={{ fontSize: 11, color: "var(--text-muted)", wordBreak: "break-all" }}>
          Dropbox: {r.path}
          {r.alpha && " · transparent areas shown on grey"}
        </div>
      </div>
    </div>
  );
}

function Meter({ name, free, total, note }: { name: string; free: number; total: number; note?: string }) {
  const usedPct = total > 0 ? Math.round(((total - free) / total) * 100) : 0;
  const tone = usedPct > 92 ? "var(--red)" : usedPct > 80 ? "var(--amber)" : "var(--green)";
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <span style={{ color: "var(--text-dim)" }}>{name}</span>
        <span>{free} / {total} GB</span>
      </div>
      <div style={{ height: 5, background: "var(--bg-elevated)", marginTop: 3 }}>
        <div style={{ height: "100%", width: `${usedPct}%`, background: tone }} />
      </div>
      {note && <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 2 }}>{note}</div>}
    </div>
  );
}
