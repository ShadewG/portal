import { promises as fs } from "fs";
import { prisma } from "@/lib/db";

// Written every 2 minutes by /opt/apps/usage-monitor/collect.py (systemd user timer
// usage-monitor.timer). The files hold usage numbers only, never tokens.
const DATA_DIR = process.env.USAGE_MONITOR_DIR || "/opt/apps/usage-monitor/data";

export type UsageWindow = {
  key: string;
  label: string;
  used: number;
  resets_at: number | null;
  window_seconds: number;
  // added here
  used_24h?: number | null;
  runs_out_at?: number | null;
  pace_known?: boolean;
};

export type UsageAccount = {
  id: string;
  kind: "codex" | "claude";
  role: string;
  email?: string | null;
  plan?: string;
  status: "ok" | "limited" | "stale" | "error" | "unknown";
  limited?: boolean;
  credits?: number | null;
  note?: string;
  windows: UsageWindow[];
};

type Sample = { t: number; a: Record<string, Record<string, number>> };

export type UsageSeries = { id: string; key: string; points: [number, number][] };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function isPortalAdmin(session: any): Promise<boolean> {
  const user = (session?.user as Record<string, unknown> | undefined) ?? undefined;
  const discordId = user?.discordId as string | undefined;
  const email = user?.email as string | undefined;
  const username = (user?.username as string | undefined) ?? (user?.name as string | undefined);
  if (discordId && discordId === process.env.ADMIN_DISCORD_ID) return true;
  if (!discordId && !email && !username) return false;
  const dbUser = await prisma.user.findFirst({
    where: {
      OR: [
        ...(discordId ? [{ discordId }] : []),
        ...(email ? [{ email }] : []),
        ...(username ? [{ username }] : []),
      ],
    },
  });
  return dbUser?.isAdmin ?? false;
}

async function readHistory(): Promise<Sample[]> {
  try {
    const raw = await fs.readFile(`${DATA_DIR}/history.jsonl`, "utf8");
    const out: Sample[] = [];
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      try {
        out.push(JSON.parse(line));
      } catch {
        /* a half-written line is skipped */
      }
    }
    return out.sort((x, y) => x.t - y.t);
  } catch {
    return [];
  }
}

/**
 * Pace for one window, from samples inside the CURRENT window only (a reset drops the
 * value, so anything before the last drop is ignored). Uses up to the last 12 hours;
 * needs at least one hour of data before it will predict anything.
 */
function pace(samples: Sample[], id: string, w: UsageWindow, now: number) {
  const series: [number, number][] = [];
  for (const s of samples) {
    const v = s.a?.[id]?.[w.key];
    if (typeof v === "number") series.push([s.t, v]);
  }
  let start = 0;
  for (let i = 1; i < series.length; i++) if (series[i][1] < series[i - 1][1] - 0.5) start = i;
  const current = series.slice(start);

  const dayAgo = current.find(([t]) => t >= now - 86400);
  const used24h = dayAgo && current[0][0] <= now - 86400 + 900 ? w.used - dayAgo[1] : null;

  const recent = current.filter(([t]) => t >= now - 12 * 3600);
  if (recent.length < 2 || recent[recent.length - 1][0] - recent[0][0] < 3600) {
    return { used_24h: used24h, runs_out_at: null, pace_known: false };
  }
  const [t0, v0] = recent[0];
  const [t1, v1] = recent[recent.length - 1];
  const perSecond = (v1 - v0) / (t1 - t0);
  if (w.used >= 100) return { used_24h: used24h, runs_out_at: now, pace_known: true };
  if (perSecond <= 0) return { used_24h: used24h, runs_out_at: null, pace_known: true };
  const runsOut = now + (100 - w.used) / perSecond;
  return {
    used_24h: used24h,
    runs_out_at: w.resets_at && runsOut >= w.resets_at ? null : runsOut,
    pace_known: true,
  };
}

/** Last 7 days of each account's main window, averaged into 30-minute buckets. */
function buildSeries(samples: Sample[], accounts: UsageAccount[], now: number): UsageSeries[] {
  const from = now - 7 * 86400;
  const bucket = 1800;
  return accounts
    .map((a) => {
      const key = a.windows.find((w) => w.key === "weekly" || w.key === "seven_day")?.key;
      if (!key) return null;
      const sums = new Map<number, [number, number]>();
      for (const s of samples) {
        if (s.t < from) continue;
        const v = s.a?.[a.id]?.[key];
        if (typeof v !== "number") continue;
        const b = Math.floor(s.t / bucket) * bucket;
        const cur = sums.get(b) ?? [0, 0];
        sums.set(b, [cur[0] + v, cur[1] + 1]);
      }
      const points = [...sums.entries()]
        .sort((x, y) => x[0] - y[0])
        .map(([t, [sum, n]]) => [t, Math.round((sum / n) * 10) / 10] as [number, number]);
      return { id: a.id, key, points };
    })
    .filter((s): s is UsageSeries => s !== null);
}

export async function readUsage() {
  const now = Date.now() / 1000;
  let snap: { at: number; accounts: UsageAccount[] } | null = null;
  try {
    snap = JSON.parse(await fs.readFile(`${DATA_DIR}/latest.json`, "utf8"));
  } catch {
    return { ok: false as const, error: "The usage collector has not written any data yet." };
  }
  const samples = await readHistory();
  const accounts = snap!.accounts.map((a) => ({
    ...a,
    windows: a.windows.map((w) => ({ ...w, ...pace(samples, a.id, w, now) })),
  }));
  return {
    ok: true as const,
    at: snap!.at,
    now,
    accounts,
    series: buildSeries(samples, accounts, now),
    history_from: samples.length ? samples[0].t : null,
  };
}
