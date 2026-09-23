"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type Win = {
  key: string;
  label: string;
  used: number;
  resets_at: number | null;
  window_seconds: number;
  used_24h?: number | null;
  runs_out_at?: number | null;
  pace_known?: boolean;
};
type Account = {
  id: string;
  kind: "codex" | "claude";
  role: string;
  email?: string | null;
  plan?: string;
  status: "ok" | "limited" | "stale" | "error" | "unknown";
  credits?: number | null;
  note?: string;
  windows: Win[];
};
type Series = { id: string; key: string; points: [number, number][] };
type Payload =
  | { ok: true; at: number; now: number; accounts: Account[]; series: Series[]; history_from: number | null }
  | { ok: false; error: string };

// Categorical order, validated on the portal surface #111118 (dark): all checks pass.
const SERIES_COLORS: Record<string, string> = {
  "codex-4": "#3987e5",
  "codex-3": "#d95926",
  "codex-main": "#199e70",
  claude: "#c98500",
};
const REFRESH_MS = 30_000;

function fmtWhen(ts: number) {
  return new Date(ts * 1000).toLocaleString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function fmtIn(seconds: number) {
  if (seconds <= 0) return "now";
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function level(used: number, limited: boolean) {
  if (limited || used >= 100) return { color: "var(--red)", icon: "■", label: "Out" };
  if (used >= 90) return { color: "var(--red)", icon: "▲", label: "Almost out" };
  if (used >= 70) return { color: "var(--amber)", icon: "▲", label: "Getting close" };
  return { color: "var(--green)", icon: "●", label: "OK" };
}

function shortName(a: Account) {
  if (a.kind === "claude") return "Claude";
  return a.email ?? a.id;
}

export default function UsagePage() {
  const [data, setData] = useState<Payload | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [clock, setClock] = useState(() => Date.now() / 1000);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/usage", { cache: "no-store" });
      if (res.status === 403) {
        setForbidden(true);
        return;
      }
      if (res.ok) setData(await res.json());
    } catch {
      /* keep the last good data on a network blip */
    }
  }, []);

  useEffect(() => {
    void load();
    const poll = setInterval(load, REFRESH_MS);
    const tick = setInterval(() => setClock(Date.now() / 1000), 1000);
    return () => {
      clearInterval(poll);
      clearInterval(tick);
    };
  }, [load]);

  const codex = data && data.ok ? data.accounts.filter((a) => a.kind === "codex") : [];
  const available = codex.filter((a) => a.status === "ok").length;
  const age = data && data.ok ? clock - data.at : 0;

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)" }}>
      <header
        style={{
          borderBottom: "1px solid var(--border)",
          padding: "14px 16px",
          display: "flex",
          alignItems: "center",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <a href="/" style={{ color: "var(--text-dim)", textDecoration: "none", fontSize: 18 }}>⌘</a>
        <span style={{ color: "var(--border)" }}>/</span>
        <h1 style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.15em", textTransform: "uppercase", margin: 0 }}>
          AI Usage
        </h1>
        {data && data.ok && (
          <span style={{ marginLeft: "auto", fontSize: 11, color: age > 360 ? "var(--red)" : "var(--text-muted)" }}>
            {age > 360 ? `▲ Data is ${fmtIn(age)} old — the collector may have stopped` : `Updated ${fmtIn(age)} ago`}
          </span>
        )}
      </header>

      <main style={{ maxWidth: 1180, margin: "0 auto", padding: "28px 16px 48px" }}>
        {forbidden && <p style={{ color: "var(--text-dim)" }}>This page is for portal admins.</p>}
        {!forbidden && !data && <p style={{ color: "var(--text-dim)" }}>Loading…</p>}
        {data && !data.ok && <p style={{ color: "var(--red)" }}>{data.error}</p>}

        {data && data.ok && (
          <>
            <section style={{ marginBottom: 24 }}>
              <div style={{ fontSize: 22, fontWeight: 700, marginBottom: 6 }}>
                {available === codex.length
                  ? "All bot accounts have room left"
                  : available === 0
                    ? "Every bot account is out — the bots cannot run"
                    : `${available} of ${codex.length} bot accounts have room left`}
              </div>
              <div style={{ fontSize: 12, color: "var(--text-dim)", lineHeight: 1.6 }}>
                The Hermes bots (InsanityBot, Autobot, DayDesk…) share the three Codex accounts and move to the next
                one when an account runs out. Claude is the account Claude Code runs on. Numbers refresh every 2
                minutes; this page updates itself.
              </div>
            </section>

            <section
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
                gap: 14,
                marginBottom: 32,
              }}
            >
              {data.accounts.map((a) => (
                <AccountCard key={a.id} a={a} now={clock} />
              ))}
            </section>

            <UsageChart series={data.series} accounts={data.accounts} historyFrom={data.history_from} now={data.now} />
          </>
        )}
      </main>
    </div>
  );
}

function AccountCard({ a, now }: { a: Account; now: number }) {
  const broken = a.status === "stale" || a.status === "error" || a.status === "unknown";
  return (
    <div
      style={{
        background: "var(--bg-surface)",
        border: "1px solid var(--border)",
        padding: 18,
        display: "flex",
        flexDirection: "column",
        gap: 14,
        minWidth: 0,
      }}
    >
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ width: 10, height: 10, borderRadius: 999, background: SERIES_COLORS[a.id] ?? "var(--text-dim)", flex: "none" }} />
          <span style={{ fontSize: 13, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {a.kind === "claude" ? "Claude" : a.email ?? a.id}
          </span>
        </div>
        <div style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 4 }}>
          {a.role}
          {a.plan ? ` · ${a.plan}` : ""}
          {a.kind === "claude" && a.email ? ` · ${a.email}` : ""}
        </div>
      </div>

      {broken && (
        <div style={{ fontSize: 12, color: "var(--amber)" }}>
          ▲ {a.note ?? "Usage could not be read right now."}
        </div>
      )}

      {a.windows.map((w) => (
        <WindowMeter key={w.key} w={w} limited={a.status === "limited" && w.used >= 100} now={now} />
      ))}

      {typeof a.credits === "number" && a.credits > 0 && (
        <div style={{ fontSize: 11, color: "var(--text-dim)" }}>
          Extra credits on the account: ${a.credits.toFixed(2)} (used only after the plan limit)
        </div>
      )}
    </div>
  );
}

function WindowMeter({ w, limited, now }: { w: Win; limited: boolean; now: number }) {
  const lv = level(w.used, limited);
  const pct = Math.max(0, Math.min(100, w.used));
  const resetIn = w.resets_at ? w.resets_at - now : null;
  let pace: { text: string; color: string } | null = null;
  if (w.used >= 100) {
    pace = null;
  } else if (w.runs_out_at) {
    pace = { text: `At the current pace it runs out ${fmtWhen(w.runs_out_at)} (in ${fmtIn(w.runs_out_at - now)}) — before it resets`, color: "var(--red)" };
  } else if (w.pace_known) {
    pace = { text: "At the current pace it lasts until it resets", color: "var(--text-dim)" };
  } else {
    pace = { text: "Pace: needs an hour of data", color: "var(--text-muted)" };
  }

  return (
    <div>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, marginBottom: 6 }}>
        <span style={{ fontSize: 11, color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: "0.08em" }}>{w.label}</span>
        <span style={{ fontSize: 11, color: lv.color, fontWeight: 600 }}>
          {lv.icon} {lv.label}
        </span>
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginBottom: 8 }}>
        <span style={{ fontSize: 30, fontWeight: 700, lineHeight: 1 }}>{Math.round(w.used)}%</span>
        <span style={{ fontSize: 12, color: "var(--text-dim)" }}>used</span>
        {typeof w.used_24h === "number" && (
          <span style={{ fontSize: 11, color: "var(--text-muted)", marginLeft: "auto" }}>
            +{Math.max(0, Math.round(w.used_24h))}% in 24h
          </span>
        )}
      </div>
      <div
        role="meter"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(pct)}
        aria-label={`${w.label} usage`}
        style={{ height: 8, background: "var(--bg-elevated)", borderRadius: 4, overflow: "hidden" }}
      >
        <div style={{ width: `${pct}%`, height: "100%", background: lv.color, borderRadius: 4 }} />
      </div>
      <div style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 8, lineHeight: 1.5 }}>
        {w.resets_at ? (
          <>
            Resets {fmtWhen(w.resets_at)}
            {resetIn !== null && resetIn > 0 ? ` (in ${fmtIn(resetIn)})` : ""}
          </>
        ) : (
          "Reset time unknown"
        )}
        {pace && <div style={{ color: pace.color }}>{pace.text}</div>}
      </div>
    </div>
  );
}

function UsageChart({
  series,
  accounts,
  historyFrom,
  now,
}: {
  series: Series[];
  accounts: Account[];
  historyFrom: number | null;
  now: number;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(800);
  const [hoverT, setHoverT] = useState<number | null>(null);

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const H = 240;
  const pad = { l: 40, r: width < 520 ? 12 : 112, t: 12, b: 28 };
  const x0 = now - 7 * 86400;
  const x = useCallback((t: number) => pad.l + ((t - x0) / (now - x0)) * (width - pad.l - pad.r), [pad.l, pad.r, width, x0, now]);
  const y = (v: number) => pad.t + (1 - v / 100) * (H - pad.t - pad.b);
  const byId = useMemo(() => Object.fromEntries(accounts.map((a) => [a.id, a])), [accounts]);
  const hasData = series.some((s) => s.points.length > 1);

  const days: number[] = [];
  const firstDay = new Date(x0 * 1000);
  firstDay.setHours(0, 0, 0, 0);
  for (let d = firstDay.getTime() / 1000 + 86400; d < now; d += 86400) days.push(d);

  const hovered =
    hoverT === null
      ? []
      : series
          .map((s) => {
            let best: [number, number] | null = null;
            for (const p of s.points) if (!best || Math.abs(p[0] - hoverT) < Math.abs(best[0] - hoverT)) best = p;
            return best && Math.abs(best[0] - hoverT) <= 3600 ? { s, p: best } : null;
          })
          .filter((h): h is { s: Series; p: [number, number] } => h !== null);

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - r.left;
    if (px < pad.l || px > width - pad.r) return setHoverT(null);
    setHoverT(x0 + ((px - pad.l) / (width - pad.l - pad.r)) * (now - x0));
  };

  return (
    <section style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", padding: 18 }}>
      <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>Weekly usage, last 7 days</div>
      <div style={{ fontSize: 11, color: "var(--text-dim)", marginBottom: 12 }}>
        % of each account&apos;s weekly limit. A drop to 0 is a weekly reset.
        {historyFrom && historyFrom > x0 ? ` History starts ${fmtWhen(historyFrom)}.` : ""}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 16px", marginBottom: 10 }}>
        {series.map((s) => (
          <span key={s.id} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--text-dim)" }}>
            <span style={{ width: 14, height: 2, background: SERIES_COLORS[s.id], display: "inline-block" }} />
            {byId[s.id] ? shortName(byId[s.id]) : s.id}
          </span>
        ))}
      </div>
      <div ref={boxRef} style={{ position: "relative", width: "100%" }}>
        {!hasData && (
          <div style={{ fontSize: 12, color: "var(--text-muted)", padding: "40px 0", textAlign: "center" }}>
            Collecting history — the chart fills in over the next hours.
          </div>
        )}
        {hasData && (
          <svg
            width={width}
            height={H}
            style={{ display: "block", touchAction: "pan-y" }}
            onPointerMove={onMove}
            onPointerLeave={() => setHoverT(null)}
            role="img"
            aria-label="Weekly usage percentage per account over the last 7 days"
          >
            {[0, 50, 100].map((v) => (
              <g key={v}>
                <line x1={pad.l} x2={width - pad.r} y1={y(v)} y2={y(v)} stroke="var(--border)" strokeWidth={1} />
                <text x={pad.l - 8} y={y(v) + 4} textAnchor="end" fontSize={10} fill="var(--text-muted)">
                  {v}%
                </text>
              </g>
            ))}
            {days.map((d) => (
              <text key={d} x={x(d)} y={H - 8} textAnchor="middle" fontSize={10} fill="var(--text-muted)">
                {new Date(d * 1000).toLocaleDateString(undefined, { weekday: "short" })}
              </text>
            ))}
            {series.map((s) => {
              if (s.points.length < 2) return null;
              // break the line across gaps longer than 2 hours (collector down)
              let dStr = "";
              s.points.forEach(([t, v], i) => {
                const gap = i > 0 && t - s.points[i - 1][0] > 7200;
                dStr += `${i === 0 || gap ? "M" : "L"}${x(t).toFixed(1)},${y(v).toFixed(1)}`;
              });
              const last = s.points[s.points.length - 1];
              return (
                <g key={s.id}>
                  <path d={dStr} fill="none" stroke={SERIES_COLORS[s.id]} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                  {width >= 520 && (
                    <text x={x(last[0]) + 8} y={y(last[1]) + 4} fontSize={10} fill="var(--text-dim)">
                      {(byId[s.id] ? shortName(byId[s.id]) : s.id).split("@")[0].slice(0, 9)} {Math.round(last[1])}%
                    </text>
                  )}
                </g>
              );
            })}
            {hoverT !== null && (
              <g pointerEvents="none">
                <line x1={x(hoverT)} x2={x(hoverT)} y1={pad.t} y2={H - pad.b} stroke="var(--border-bright)" strokeWidth={1} />
                {hovered.map(({ s, p }) => (
                  <circle key={s.id} cx={x(p[0])} cy={y(p[1])} r={4} fill={SERIES_COLORS[s.id]} stroke="var(--bg-surface)" strokeWidth={2} />
                ))}
              </g>
            )}
          </svg>
        )}
        {hasData && hoverT !== null && hovered.length > 0 && (
          <div
            style={{
              position: "absolute",
              top: 8,
              left: Math.min(Math.max(x(hoverT) + 12, 0), width - 200),
              width: 188,
              background: "var(--bg-elevated)",
              border: "1px solid var(--border-bright)",
              padding: "8px 10px",
              fontSize: 11,
              pointerEvents: "none",
            }}
          >
            <div style={{ color: "var(--text-dim)", marginBottom: 6 }}>{fmtWhen(hoverT)}</div>
            {hovered.map(({ s, p }) => (
              <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
                <span style={{ width: 8, height: 8, borderRadius: 999, background: SERIES_COLORS[s.id] }} />
                <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--text-dim)" }}>
                  {byId[s.id] ? shortName(byId[s.id]) : s.id}
                </span>
                <span style={{ color: "var(--text)", fontWeight: 600 }}>{Math.round(p[1])}%</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
