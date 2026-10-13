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
  status: "ok" | "limited" | "stale" | "error" | "unknown" | "logged_out";
  credits?: number | null;
  note?: string;
  resets_banked?: number | null;
  resets_usable?: number | null;
  extra_usage?: { enabled: boolean; reason?: string | null; used?: number | null; limit?: number | null; currency?: string; decimals?: number };
  breakdown?: { name: string; percent: number }[];
  windows: Win[];
};
type Series = { id: string; key: string; points: [number, number][] };
type Row = { name: string; share: number; dollars: number; calls?: number; runs?: number; group?: string; sessions?: number; pct_of_week?: number; kind?: string };
type Family = "codex" | "claude";
type Run = { who: string; what?: string; task?: string; dollars: number; calls?: number; at?: number; source?: string; model?: string };
type Stats = {
  at: number;
  windows: Record<
    "24h" | "7d",
    {
      bots: Row[];
      codex_total: number;
      tasks: Record<string, Row[]>;
      claude: Row[];
      claude_total: number;
      claude_models: Row[];
      accounts: Record<string, { rise: number; rows: { name: string; dollars: number; pct: number }[]; watched_hours: number }>;
      watched_since: number;
    }
  >;
  hourly: Record<Family, { hours: number[]; series: Record<string, number[]> }>;
  top_runs: Record<Family, Run[]>;
};
type ResetEvent = {
  t: number;
  account: string;
  name?: string;
  window?: string;
  kind: "reset" | "early_reset" | "reset_credit_used" | "reset_credit_added";
  from?: number;
  to?: number;
  count?: number;
  banked?: number;
  was_due?: number;
  recovered?: boolean;
};
type Payload =
  | {
      ok: true;
      at: number;
      now: number;
      accounts: Account[];
      series: Series[];
      history_from: number | null;
      stats: Stats | null;
      events: ResetEvent[];
    }
  | { ok: false; error: string };
type Tab = "overview" | "using" | "resets";
const TABS: { id: Tab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "using", label: "What's using it" },
  { id: "resets", label: "Resets" },
];
// Stacked-chart slots, validated on #111118 (dark): all checks pass. "Other" is neutral.
const STACK_COLORS = ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181"];
const OTHER_COLOR = "#55556a";

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

function money(minor: number | null | undefined, decimals = 2) {
  if (typeof minor !== "number") return "—";
  return `$${(minor / 10 ** decimals).toFixed(2)}`;
}

function fmtDollars(v: number) {
  return v >= 100 ? `$${Math.round(v).toLocaleString()}` : `$${v.toFixed(2)}`;
}

function shortName(a: Account) {
  if (a.kind === "claude") return "Claude";
  return a.email ?? a.id;
}

export default function UsagePage() {
  const [data, setData] = useState<Payload | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [clock, setClock] = useState(() => Date.now() / 1000);
  const [tab, setTab] = useState<Tab>("overview");

  useEffect(() => {
    const fromHash = () => {
      const h = window.location.hash.replace("#", "") as Tab;
      if (TABS.some((t) => t.id === h)) setTab(h);
    };
    fromHash();
    window.addEventListener("hashchange", fromHash);
    return () => window.removeEventListener("hashchange", fromHash);
  }, []);

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
          <nav role="tablist" style={{ display: "flex", gap: 4, borderBottom: "1px solid var(--border)", marginBottom: 24, overflowX: "auto" }}>
            {TABS.map((t) => (
              <a
                key={t.id}
                role="tab"
                aria-selected={tab === t.id}
                href={`#${t.id}`}
                onClick={() => setTab(t.id)}
                style={{
                  padding: "10px 14px",
                  fontSize: 12,
                  fontWeight: 600,
                  whiteSpace: "nowrap",
                  textDecoration: "none",
                  color: tab === t.id ? "var(--text)" : "var(--text-dim)",
                  borderBottom: tab === t.id ? "2px solid var(--accent)" : "2px solid transparent",
                  marginBottom: -1,
                }}
              >
                {t.label}
              </a>
            ))}
          </nav>
        )}

        {data && data.ok && tab === "using" && <UsingTab stats={data.stats} accounts={data.accounts} />}
        {data && data.ok && tab === "resets" && <ResetsTab accounts={data.accounts} events={data.events} now={clock} historyFrom={data.history_from} />}

        {data && data.ok && tab === "overview" && (
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
  const broken = a.status === "stale" || a.status === "error" || a.status === "unknown" || a.status === "logged_out";
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

      {a.status === "logged_out" && (
        <div style={{ fontSize: 12, color: "var(--red)", lineHeight: 1.6 }}>
          <div style={{ fontWeight: 700, marginBottom: 4 }}>■ Logged out — needs signing in again</div>
          OpenAI rejected this account&apos;s login, so the bots can&apos;t use it and fall back to the other accounts.
        </div>
      )}
      {broken && a.status !== "logged_out" && (
        <div style={{ fontSize: 12, color: "var(--amber)" }}>
          ▲ {a.note ?? "Usage could not be read right now."}
        </div>
      )}

      {a.windows.map((w) => (
        <WindowMeter key={w.key} w={w} limited={a.status === "limited" && w.used >= 100} now={now} />
      ))}

      {a.kind === "codex" && typeof a.resets_banked === "number" && (
        <div style={{ fontSize: 11, color: a.resets_usable ? "var(--amber)" : "var(--text-dim)" }}>
          {a.resets_banked === 0
            ? "No banked resets"
            : a.resets_usable
              ? `▲ ${a.resets_usable} banked reset${a.resets_usable === 1 ? "" : "s"} ready to use now (${a.resets_banked} banked)`
              : `${a.resets_banked} banked reset${a.resets_banked === 1 ? "" : "s"} — usable once this account runs out`}
        </div>
      )}

      {a.kind === "claude" && a.extra_usage && (
        <div style={{ fontSize: 11, color: "var(--text-dim)" }}>
          Extra usage after the limit:{" "}
          {a.extra_usage.enabled
            ? `on — ${money(a.extra_usage.used, a.extra_usage.decimals)} of ${money(a.extra_usage.limit, a.extra_usage.decimals)} this month`
            : `off${a.extra_usage.reason === "out_of_credits" ? " (no credits)" : ""}`}
        </div>
      )}

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
        % of each account&apos;s weekly limit. A drop to 0 is a reset. Dashed = no readings in between (history before
        23 Sep only has readings from when Codex was used by hand).
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
              // solid where readings are continuous; a faint dashed bridge across gaps
              // longer than 2 hours (older history only has readings when Codex CLI ran)
              let dStr = "";
              let gapStr = "";
              s.points.forEach(([t, v], i) => {
                const gap = i > 0 && t - s.points[i - 1][0] > 7200;
                if (gap) {
                  const [pt, pv] = s.points[i - 1];
                  gapStr += `M${x(pt).toFixed(1)},${y(pv).toFixed(1)}L${x(t).toFixed(1)},${y(v).toFixed(1)}`;
                }
                dStr += `${i === 0 || gap ? "M" : "L"}${x(t).toFixed(1)},${y(v).toFixed(1)}`;
              });
              const last = s.points[s.points.length - 1];
              return (
                <g key={s.id}>
                  {gapStr && (
                    <path d={gapStr} fill="none" stroke={SERIES_COLORS[s.id]} strokeWidth={1} strokeDasharray="3 4" opacity={0.45} />
                  )}
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

/* ------------------------------------------------------------------ What's using it */

type AcctRow = { name: string; dollars: number; pct: number };
type View = "bots" | "codex-4" | "codex-3" | "codex-main" | "claude";

function UsingTab({ stats, accounts }: { stats: Stats | null; accounts: Account[] }) {
  const [range, setRange] = useState<"24h" | "7d">("24h");
  const [view, setView] = useState<View>("bots");
  if (!stats) {
    return <p style={{ color: "var(--text-dim)" }}>The usage breakdown is being prepared — it refreshes every 10 minutes.</p>;
  }
  const w = stats.windows[range];
  const byId = Object.fromEntries(accounts.map((a) => [a.id, a]));
  const views: { id: View; label: string; sub: string }[] = [
    { id: "bots", label: "All bots & Codex CLI", sub: "everything on the 3 Codex accounts" },
    ...(["codex-4", "codex-3", "codex-main"] as const).map((id) => ({
      id,
      label: byId[id]?.email ?? id,
      sub: byId[id]?.role ?? "",
    })),
    { id: "claude", label: "Claude", sub: "Claude Code sessions" },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 8 }}>
        {views.map((v) => {
          const on = view === v.id;
          const acc = w.accounts?.[v.id];
          return (
            <button
              key={v.id}
              onClick={() => setView(v.id)}
              aria-pressed={on}
              style={{
                textAlign: "left",
                padding: "10px 12px",
                fontFamily: "inherit",
                cursor: "pointer",
                background: on ? "var(--bg-elevated)" : "var(--bg-surface)",
                border: `1px solid ${on ? "var(--accent)" : "var(--border)"}`,
                color: "var(--text)",
                minWidth: 0,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                {v.id !== "bots" && <span style={{ width: 8, height: 8, borderRadius: 999, background: SERIES_COLORS[v.id], flex: "none" }} />}
                <span style={{ fontSize: 12, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{v.label}</span>
              </div>
              <div style={{ fontSize: 10, color: "var(--text-dim)", marginTop: 3 }}>
                {acc ? `+${acc.rise}% of its week since ${fmtClock(w.watched_since)}` : v.sub}
              </div>
            </button>
          );
        })}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div role="group" aria-label="Time range" style={{ display: "inline-flex", border: "1px solid var(--border)" }}>
          {(["24h", "7d"] as const).map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              aria-pressed={range === r}
              style={{
                padding: "6px 12px",
                fontSize: 11,
                fontFamily: "inherit",
                cursor: "pointer",
                border: "none",
                background: range === r ? "var(--bg-elevated)" : "transparent",
                color: range === r ? "var(--text)" : "var(--text-dim)",
              }}
            >
              {r === "24h" ? "Last 24 hours" : "Last 7 days"}
            </button>
          ))}
        </div>
        <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
          $ = what the usage would cost at public API prices (a yardstick, not a bill). Refreshed {fmtIn(Date.now() / 1000 - stats.at)} ago.
        </span>
      </div>

      {view === "bots" && <BotsView w={w} stats={stats} />}
      {(view === "codex-4" || view === "codex-3" || view === "codex-main") && (
        <AccountView acct={w.accounts?.[view]} name={byId[view]?.email ?? view} since={w.watched_since} range={range} />
      )}
      {view === "claude" && <ClaudeView w={w} stats={stats} since={w.watched_since} range={range} />}
    </div>
  );
}

function fmtClock(ts: number) {
  const d = new Date(ts * 1000);
  const today = new Date();
  const time = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  return d.toDateString() === today.toDateString() ? time : `${d.toLocaleDateString(undefined, { day: "numeric", month: "short" })} ${time}`;
}

function Panel({ title, sub, children }: { title: string; sub?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", padding: 18, minWidth: 0 }}>
      <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 6 }}>{title}</div>
      {sub && <div style={{ fontSize: 12, color: "var(--text-dim)", marginBottom: 16, lineHeight: 1.6 }}>{sub}</div>}
      {children}
    </section>
  );
}

function ShareRow({
  name,
  tag,
  share,
  right,
  onClick,
  open,
  indent,
}: {
  name: string;
  tag?: string;
  share: number;
  right: string;
  onClick?: () => void;
  open?: boolean;
  indent?: boolean;
}) {
  return (
    <div
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={(e) => {
        if (onClick && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          onClick();
        }
      }}
      style={{ minWidth: 0, cursor: onClick ? "pointer" : "default", paddingLeft: indent ? 18 : 0 }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 4, flexWrap: "wrap" }}>
        {onClick && <span style={{ fontSize: 10, color: "var(--text-dim)", width: 10 }}>{open ? "▾" : "▸"}</span>}
        <span style={{ fontSize: indent ? 11 : 12, fontWeight: indent ? 500 : 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "100%" }}>
          {name}
        </span>
        {tag && <span style={{ fontSize: 10, color: "var(--text-muted)" }}>{tag}</span>}
        <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--text-dim)", whiteSpace: "nowrap" }}>{right}</span>
      </div>
      <div style={{ height: indent ? 4 : 6, background: "var(--bg-elevated)", borderRadius: 3 }}>
        <div
          style={{
            width: `${Math.max(0.5, Math.min(100, share))}%`,
            height: "100%",
            background: indent ? "#6da7ec" : "#3987e5",
            borderRadius: 3,
          }}
        />
      </div>
    </div>
  );
}

const KIND_TEXT: Record<string, string> = {
  cli: "script",
  cron: "scheduled",
  discord: "Discord",
  subagent: "helper agents",
  tool: "app-triggered",
  api_server: "app request",
};

function BotsView({ w, stats }: { w: Stats["windows"]["24h"]; stats: Stats }) {
  const [open, setOpen] = useState<string | null>(null);
  const [all, setAll] = useState(false);
  const rows = w.bots;
  const shown = all ? rows : rows.slice(0, 12);
  return (
    <>
      <Panel
        title="Who used the Codex accounts"
        sub={
          <>
            {fmtDollars(w.codex_total)} of usage across the three Codex accounts. Click a bot to see its jobs and tasks.
            {rows.some((r) => typeof r.pct_of_week === "number") &&
              ` “≈% of a week” adds up what each bot moved the account meters since ${fmtClock(w.watched_since)} (one account's full week = 100%).`}
          </>
        }
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {shown.map((r) => {
            const tasks = w.tasks?.[r.name];
            const isOpen = open === r.name;
            return (
              <div key={r.name} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <ShareRow
                  name={r.name}
                  tag={r.group}
                  share={r.share}
                  open={isOpen}
                  onClick={tasks ? () => setOpen(isOpen ? null : r.name) : undefined}
                  right={[
                    `${r.share.toFixed(r.share < 1 ? 1 : 0)}%`,
                    fmtDollars(r.dollars),
                    typeof r.pct_of_week === "number" ? `≈${r.pct_of_week < 1 ? "<1" : Math.round(r.pct_of_week)}% of a week` : "",
                    r.runs ? `${r.runs.toLocaleString()} runs` : r.calls ? `${r.calls.toLocaleString()} replies` : "",
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                />
                {isOpen && tasks && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8, borderLeft: "1px solid var(--border)", marginLeft: 4, padding: "4px 0 8px" }}>
                    {tasks.map((t) => (
                      <ShareRow
                        key={t.name}
                        indent
                        name={t.name}
                        tag={t.kind ? t.kind.split(", ").map((k) => KIND_TEXT[k] ?? k).join(", ") : undefined}
                        share={t.share}
                        right={`${t.share.toFixed(t.share < 1 ? 1 : 0)}% of ${r.name} · ${fmtDollars(t.dollars)} · ${t.runs ?? 0} runs`}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        {rows.length > 12 && (
          <button
            onClick={() => setAll(!all)}
            style={{ marginTop: 12, fontSize: 11, fontFamily: "inherit", background: "none", border: "none", color: "var(--accent)", cursor: "pointer", padding: 0 }}
          >
            {all ? "Show top 12" : `Show all ${rows.length}`}
          </button>
        )}
        <StackedHourly data={stats.hourly.codex} title="Who used it, per 3 hours (last 7 days)" />
      </Panel>
      <RunsPanel title="Heaviest single runs, last 24 hours" runs={stats.top_runs.codex} unit="calls" />
    </>
  );
}

function AccountView({ acct, name, since, range }: { acct?: { rise: number; rows: AcctRow[]; watched_hours: number }; name: string; since: number; range: string }) {
  if (!acct) return <Panel title={name} sub="No data for this account yet." children={null} />;
  const rows = acct.rows;
  const maxPct = Math.max(1e-9, ...rows.map((r) => r.pct));
  return (
    <Panel
      title={`What used ${name}`}
      sub={
        <>
          Its weekly meter rose <b style={{ color: "var(--text)" }}>{acct.rise}%</b> since {fmtClock(since)}
          {range === "7d" ? " (the monitor started then)" : ""}. Each hour, bot usage is given to the account whose meter moved, then
          that rise is split by how much each bot used — an estimate, since the bots don&apos;t record which account served them.
        </>
      }
    >
      {rows.length === 0 && <div style={{ fontSize: 12, color: "var(--text-muted)" }}>Nothing moved this account&apos;s meter in this period.</div>}
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {rows.map((r) => (
          <ShareRow
            key={r.name}
            name={r.name}
            tag={r.name === "Not seen on this server" ? "used somewhere else — another computer, the Codex app or ChatGPT" : undefined}
            share={(r.pct / maxPct) * 100}
            right={`≈${r.pct < 0.1 ? "<0.1" : r.pct.toFixed(1)}% of its week${r.dollars ? ` · ${fmtDollars(r.dollars)}` : ""}`}
          />
        ))}
      </div>
    </Panel>
  );
}

function ClaudeView({ w, stats, since, range }: { w: Stats["windows"]["24h"]; stats: Stats; since: number; range: string }) {
  const [all, setAll] = useState(false);
  const acct = w.accounts?.claude;
  const rows = w.claude;
  const shown = all ? rows : rows.slice(0, 12);
  return (
    <>
      <Panel
        title="What used Claude"
        sub={
          <>
            {fmtDollars(w.claude_total)} of Claude Code usage, one row per session (by topic; helper agents count under their session).
            {acct ? ` Claude's weekly meter rose ${acct.rise}% since ${fmtClock(since)}${range === "7d" ? " (the monitor started then)" : ""}.` : ""}
          </>
        }
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {shown.map((r) => (
            <ShareRow
              key={r.name}
              name={r.name}
              tag={r.group && r.group !== "Home folder (general)" ? r.group : undefined}
              share={r.share}
              right={[
                `${r.share.toFixed(r.share < 1 ? 1 : 0)}%`,
                fmtDollars(r.dollars),
                typeof r.pct_of_week === "number" && r.pct_of_week > 0 ? `≈${r.pct_of_week < 1 ? "<1" : Math.round(r.pct_of_week)}% of the week` : "",
                r.calls ? `${r.calls.toLocaleString()} replies` : "",
              ]
                .filter(Boolean)
                .join(" · ")}
            />
          ))}
        </div>
        {rows.length > 12 && (
          <button
            onClick={() => setAll(!all)}
            style={{ marginTop: 12, fontSize: 11, fontFamily: "inherit", background: "none", border: "none", color: "var(--accent)", cursor: "pointer", padding: 0 }}
          >
            {all ? "Show top 12" : `Show all ${rows.length}`}
          </button>
        )}
        {acct && acct.rows.some((r) => r.name === "Not seen on this server") && (
          <div style={{ fontSize: 11, color: "var(--amber)", marginTop: 12 }}>
            ▲ Part of Claude&apos;s meter moved while nothing on this server was running — usage from claude.ai or another computer.
          </div>
        )}
        {w.claude_models.length > 0 && (
          <div style={{ marginTop: 20 }}>
            <div style={{ fontSize: 11, color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>By model</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 18px", fontSize: 12 }}>
              {w.claude_models.map((r) => (
                <span key={r.name}>
                  {r.name} <b>{r.share.toFixed(0)}%</b> <span style={{ color: "var(--text-muted)" }}>({fmtDollars(r.dollars)})</span>
                </span>
              ))}
            </div>
          </div>
        )}
        <StackedHourly data={stats.hourly.claude} title="By model, per 3 hours (last 7 days)" />
      </Panel>
      <RunsPanel title="Heaviest sessions, last 24 hours" runs={stats.top_runs.claude} unit="replies" />
    </>
  );
}

function RunsPanel({ title, runs, unit }: { title: string; runs: Run[]; unit: string }) {
  return (
    <Panel title={title}>
      {runs.length === 0 && <div style={{ fontSize: 12, color: "var(--text-muted)" }}>None.</div>}
      <div style={{ display: "flex", flexDirection: "column" }}>
        {runs.map((r, i) => (
          <div key={i} style={{ display: "flex", gap: 10, alignItems: "baseline", padding: "7px 0", borderTop: i ? "1px solid var(--border)" : "none", minWidth: 0 }}>
            <span style={{ fontSize: 12, fontWeight: 700, width: 64, flex: "none", textAlign: "right" }}>{fmtDollars(r.dollars)}</span>
            <span style={{ minWidth: 0, flex: 1 }}>
              <span style={{ fontSize: 12, fontWeight: 600 }}>{r.who}</span>
              <span style={{ fontSize: 11, color: "var(--text-dim)" }}>
                {r.task ? ` · ${r.task}` : ""}
                {r.at ? ` · ${fmtWhen(r.at)}` : ""}
                {r.calls ? ` · ${r.calls} ${unit}` : ""}
              </span>
              {r.what && (
                <div style={{ fontSize: 11, color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.what}</div>
              )}
            </span>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function StackedHourly({ data, title }: { data: { hours: number[]; series: Record<string, number[]> }; title: string }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(800);
  const [hover, setHover] = useState<number | null>(null);
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  // 3-hour columns: hourly columns would be a few pixels wide
  const names = Object.keys(data.series);
  const cols: { t: number; vals: number[] }[] = [];
  for (let i = 0; i < data.hours.length; i += 3) {
    cols.push({ t: data.hours[i], vals: names.map((n) => data.series[n].slice(i, i + 3).reduce((a, b) => a + b, 0)) });
  }
  const max = Math.max(1e-9, ...cols.map((c) => c.vals.reduce((a, b) => a + b, 0)));
  const nice = niceMax(max);
  const H = 180;
  const pad = { l: 44, r: 8, t: 8, b: 22 };
  const plotW = Math.max(10, width - pad.l - pad.r);
  const colW = plotW / Math.max(1, cols.length);
  const barW = Math.max(1, colW - 2);
  const y = (v: number) => pad.t + (1 - v / nice) * (H - pad.t - pad.b);
  const color = (n: string, i: number) => (n === "Other" ? OTHER_COLOR : STACK_COLORS[i % STACK_COLORS.length]);
  if (!names.length) return null;

  return (
    <div style={{ marginTop: 20 }}>
      <div style={{ fontSize: 11, color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>{title}</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 14px", marginBottom: 8 }}>
        {names.map((n, i) => (
          <span key={n} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--text-dim)" }}>
            <span style={{ width: 10, height: 10, background: color(n, i), borderRadius: 2 }} />
            {n}
          </span>
        ))}
      </div>
      <div ref={boxRef} style={{ position: "relative", width: "100%" }}>
        <svg
          width={width}
          height={H}
          style={{ display: "block", touchAction: "pan-y" }}
          role="img"
          aria-label={title}
          onPointerMove={(e) => {
            const px = e.clientX - e.currentTarget.getBoundingClientRect().left - pad.l;
            const i = Math.floor(px / colW);
            setHover(i >= 0 && i < cols.length ? i : null);
          }}
          onPointerLeave={() => setHover(null)}
        >
          {[0, nice / 2, nice].map((v) => (
            <g key={v}>
              <line x1={pad.l} x2={width - pad.r} y1={y(v)} y2={y(v)} stroke="var(--border)" />
              <text x={pad.l - 6} y={y(v) + 4} textAnchor="end" fontSize={10} fill="var(--text-muted)">
                {fmtDollars(v)}
              </text>
            </g>
          ))}
          {cols.map((c, i) => {
            let acc = 0;
            const x = pad.l + i * colW + 1;
            return (
              <g key={c.t} opacity={hover === null || hover === i ? 1 : 0.55}>
                {c.vals.map((v, j) => {
                  if (v <= 0) return null;
                  const y0 = y(acc);
                  acc += v;
                  const y1 = y(acc);
                  // 2px surface gap between stacked segments
                  const h = Math.max(0, y0 - y1 - (acc < c.vals.reduce((a, b) => a + b, 0) ? 2 : 0));
                  return <rect key={j} x={x} y={y1} width={barW} height={h} fill={color(names[j], j)} rx={acc >= c.vals.reduce((a, b) => a + b, 0) ? 2 : 0} />;
                })}
              </g>
            );
          })}
          {cols
            .filter((c) => new Date(c.t * 1000).getHours() < 3)
            .map((c) => {
              const i = cols.indexOf(c);
              return (
                <text key={c.t} x={pad.l + i * colW + colW / 2} y={H - 6} textAnchor="middle" fontSize={10} fill="var(--text-muted)">
                  {new Date(c.t * 1000).toLocaleDateString(undefined, { weekday: "short" })}
                </text>
              );
            })}
        </svg>
        {hover !== null && (
          <div
            style={{
              position: "absolute",
              top: 4,
              left: Math.min(Math.max(pad.l + hover * colW + colW + 8, 0), width - 210),
              width: 200,
              background: "var(--bg-elevated)",
              border: "1px solid var(--border-bright)",
              padding: "8px 10px",
              fontSize: 11,
              pointerEvents: "none",
            }}
          >
            <div style={{ color: "var(--text-dim)", marginBottom: 6 }}>
              {fmtWhen(cols[hover].t)} – {new Date((cols[hover].t + 3 * 3600) * 1000).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
            </div>
            {names.map((n, j) =>
              cols[hover].vals[j] > 0 ? (
                <div key={n} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ width: 8, height: 8, borderRadius: 2, background: color(n, j) }} />
                  <span style={{ flex: 1, color: "var(--text-dim)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{n}</span>
                  <b>{fmtDollars(cols[hover].vals[j])}</b>
                </div>
              ) : null,
            )}
            {cols[hover].vals.every((v) => v <= 0) && <div style={{ color: "var(--text-muted)" }}>No usage</div>}
          </div>
        )}
      </div>
    </div>
  );
}

function niceMax(v: number) {
  const exp = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * exp >= v) return m * exp;
  return 10 * exp;
}

/* ------------------------------------------------------------------ Resets */

const EVENT_TEXT: Record<ResetEvent["kind"], string> = {
  reset: "Limit reset on schedule",
  early_reset: "Reset early, before its scheduled date — usually a banked reset being used",
  reset_credit_used: "Banked reset used",
  reset_credit_added: "New banked reset added",
};

function ResetsTab({ accounts, events, now, historyFrom }: { accounts: Account[]; events: ResetEvent[]; now: number; historyFrom: number | null }) {
  const codex = accounts.filter((a) => a.kind === "codex");
  const claude = accounts.find((a) => a.kind === "claude");
  const banked = codex.reduce((n, a) => n + (a.resets_banked ?? 0), 0);
  const usable = codex.reduce((n, a) => n + (a.resets_usable ?? 0), 0);
  const earlyIn = (id: string, days: number) =>
    events.filter((e) => e.account === id && e.kind === "early_reset" && e.t >= now - days * 86400).length;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <section>
        <div style={{ fontSize: 22, fontWeight: 700, marginBottom: 6 }}>
          {banked} banked reset{banked === 1 ? "" : "s"} across the Codex accounts
          {usable ? ` — ${usable} ready to use now` : ""}
        </div>
        <div style={{ fontSize: 12, color: "var(--text-dim)", lineHeight: 1.6 }}>
          A banked reset refills an account&apos;s weekly limit straight away. OpenAI only lets you use one when that account has run out.
          To use one: open Codex on that account and choose “Reset usage”.
        </div>
      </section>

      <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 14 }}>
        {codex.map((a) => {
          const w = a.windows.find((x) => x.key === "weekly") ?? a.windows[0];
          return (
            <div key={a.id} style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", padding: 18, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                <span style={{ width: 10, height: 10, borderRadius: 999, background: SERIES_COLORS[a.id], flex: "none" }} />
                <span style={{ fontSize: 13, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.email ?? a.id}</span>
              </div>
              <div style={{ display: "flex", gap: 24, marginBottom: 12 }}>
                <div>
                  <div style={{ fontSize: 30, fontWeight: 700, lineHeight: 1 }}>{a.resets_banked ?? "—"}</div>
                  <div style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 4 }}>banked</div>
                </div>
                <div>
                  <div style={{ fontSize: 30, fontWeight: 700, lineHeight: 1, color: a.resets_usable ? "var(--amber)" : "var(--text)" }}>
                    {a.resets_usable ?? "—"}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 4 }}>usable now</div>
                </div>
              </div>
              <div style={{ fontSize: 11, color: "var(--text-dim)", lineHeight: 1.6 }}>
                <div style={{ marginBottom: 4 }}>
                  Early resets: <b style={{ color: "var(--text)" }}>{earlyIn(a.id, 7)}</b> in the last 7 days ·{" "}
                  <b style={{ color: "var(--text)" }}>{earlyIn(a.id, 30)}</b> in 30 days
                </div>
                {w ? `${Math.round(w.used)}% of the week used. ` : ""}
                {w?.resets_at ? `Next scheduled reset ${fmtWhen(w.resets_at)} (in ${fmtIn(w.resets_at - now)}).` : ""}
                {a.resets_usable ? <div style={{ color: "var(--amber)" }}>▲ This account is out — using a banked reset would bring it back now.</div> : null}
              </div>
            </div>
          );
        })}
        {claude && (
          <div style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", padding: 18, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
              <span style={{ width: 10, height: 10, borderRadius: 999, background: SERIES_COLORS.claude, flex: "none" }} />
              <span style={{ fontSize: 13, fontWeight: 700 }}>Claude</span>
            </div>
            <div style={{ fontSize: 11, color: "var(--text-dim)", lineHeight: 1.7 }}>
              Claude has no banked resets. Its limits refill on a schedule:
              {claude.windows.map((w) => (
                <div key={w.key}>
                  {w.label}: {w.resets_at ? `${fmtWhen(w.resets_at)} (in ${fmtIn(w.resets_at - now)})` : "—"}
                </div>
              ))}
              {claude.extra_usage && (
                <div style={{ marginTop: 6 }}>
                  Extra usage after the limit: {claude.extra_usage.enabled ? "on" : "off"}
                  {claude.extra_usage.reason === "out_of_credits" ? " — no credits on the account" : ""}
                </div>
              )}
            </div>
          </div>
        )}
      </section>

      <section style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", padding: 18 }}>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>Reset history</div>
        <div style={{ fontSize: 11, color: "var(--text-dim)", marginBottom: 12 }}>
          Every reset seen since the monitor started, plus earlier ones recovered from Codex logs
          {historyFrom ? ` (back to ${fmtWhen(historyFrom)})` : ""}. Earlier resets on accounts that were not used by hand
          may be missing.
        </div>
        {events.length === 0 && <div style={{ fontSize: 12, color: "var(--text-muted)" }}>No resets seen yet.</div>}
        {events.map((e, i) => (
          <div key={i} style={{ display: "flex", gap: 12, padding: "8px 0", borderTop: i ? "1px solid var(--border)" : "none", alignItems: "baseline", flexWrap: "wrap" }}>
            <span style={{ fontSize: 11, color: "var(--text-dim)", width: 150, flex: "none" }}>{fmtWhen(e.t)}</span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6, minWidth: 0, flex: 1 }}>
              <span style={{ width: 8, height: 8, borderRadius: 999, background: SERIES_COLORS[e.account] ?? "var(--text-dim)", flex: "none" }} />
              <span style={{ fontSize: 12 }}>
                <b>{e.name ?? e.account}</b> — {EVENT_TEXT[e.kind]}
                {e.window ? ` (${e.window})` : ""}
                {typeof e.from === "number" && typeof e.to === "number" ? `: ${Math.round(e.from)}% → ${Math.round(e.to)}%` : ""}
                {e.kind === "reset_credit_used" || e.kind === "reset_credit_added" ? ` — ${e.banked ?? "?"} left` : ""}
                {e.kind === "early_reset" && e.was_due ? ` — was due ${fmtWhen(e.was_due)}` : ""}
                {e.recovered && <span style={{ color: "var(--text-muted)" }}> · from Codex logs</span>}
              </span>
            </span>
          </div>
        ))}
      </section>
    </div>
  );
}
