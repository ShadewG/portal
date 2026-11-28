/**
 * Render Farm page helpers with no React (R-3254 step 1: B8 one clock, S11 top line, S12 failed reasons + activity).
 * Checked by scripts/check-renderfarm-view.mjs.
 */

/**
 * The render PC writes its history in Norway time with no zone ("2026-11-27T12:42:11"). Read such a time in this
 * zone, unless the live answer names its own zone (`timeZone`).
 */
export const FARM_TZ = "Europe/Oslo";

const fmts = new Map<string, Intl.DateTimeFormat>();
function parts(ms: number, zone?: string) {
  const key = zone ?? "";
  let f = fmts.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone: zone, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric" });
    fmts.set(key, f);
  }
  const p: Record<string, number> = {};
  for (const { type, value } of f.formatToParts(ms)) if (type !== "literal") p[type] = Number(value);
  return { y: p.year, mo: p.month, d: p.day, h: p.hour % 24, mi: p.minute, s: p.second };
}

/** zone's offset from UTC at that moment, in ms */
function offsetAt(ms: number, zone: string): number {
  const p = parts(ms, zone);
  return Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s) - Math.floor(ms / 1000) * 1000;
}

function validZone(zone: string | undefined): string {
  if (!zone) return FARM_TZ;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return zone;
  } catch {
    return FARM_TZ;
  }
}

const WALL = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(\.\d+)?)?$/;

/**
 * Milliseconds since 1970 for a farm time. Times with Z or an offset are taken as they are; times without one are
 * wall-clock times in `zone` (default Europe/Oslo). Across the autumn change the repeated hour reads as the later
 * (winter) one; a spring time that never existed moves one hour on. NaN when it is not a time.
 */
export function parseFarmTime(ts: string | null | undefined, zone?: string): number {
  const s = String(ts ?? "").trim();
  const m = WALL.exec(s);
  if (!m) return s ? Date.parse(s) : NaN;
  const z = validZone(zone);
  const guess = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] ?? 0), Math.round(Number(m[7] ?? 0) * 1000));
  const first = offsetAt(guess, z);
  let t = guess - first;
  const second = offsetAt(t, z);
  if (second !== first) t = guess - second;
  return t;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad = (n: number) => String(n).padStart(2, "0");

/** "18:40" today, "27 Nov, 18:40" on other days, in the viewer's zone (or `zone`). "" when not a time. */
export function fmtWhen(ms: number, now = Date.now(), zone?: string): string {
  if (!Number.isFinite(ms)) return "";
  const p = parts(ms, zone);
  const n = parts(now, zone);
  const time = `${pad(p.h)}:${pad(p.mi)}`;
  return p.y === n.y && p.mo === n.mo && p.d === n.d ? time : `${p.d} ${MONTHS[p.mo - 1]}, ${time}`;
}

/** "11:33-11:44" (date first when not today, and on both ends when the days differ) */
export function fmtRange(from: number, to: number, now = Date.now(), zone?: string): string {
  const a = fmtWhen(from, now, zone);
  const b = fmtWhen(to, now, zone);
  if (a === b) return a;
  const day = (s: string) => (s.includes(", ") ? s.split(", ")[0] : "");
  return day(a) === day(b) && day(a) ? `${a}-${b.split(", ")[1]}` : `${a}-${b}`;
}

export type FarmEvent = { timestamp: string; type: string; label: string; name: string; kind: string; episode: string; detail: string };
export type ActivityItem = { row: FarmEvent } | { repeat: { name: string; kind: string; episode: string; fails: number; from: string; to: string; last: FarmEvent } };

/**
 * Activity list with retry loops folded: a run of one card's rows in a row (newest first) that holds 2 or more
 * failures becomes one item ("A_DOC-3 failed 11 times, 11:33-11:44"). A finished render ends a run.
 */
export function collapseActivity(history: FarmEvent[]): ActivityItem[] {
  const out: ActivityItem[] = [];
  const same = (a: FarmEvent, b: FarmEvent) => a.name === b.name && a.kind === b.kind;
  const finished = (h: FarmEvent) => h.type === "DONE" || h.type === "DONE-WITH-NOTES";
  for (let i = 0; i < history.length; ) {
    let j = i;
    while (j < history.length && same(history[j], history[i]) && !finished(history[j])) j++;
    const run = history.slice(i, j);
    const fails = run.filter((h) => h.type === "FAIL");
    if (fails.length >= 2) {
      out.push({ repeat: { name: run[0].name, kind: run[0].kind, episode: run[0].episode, fails: fails.length, from: run[run.length - 1].timestamp, to: run[0].timestamp, last: fails[0] } });
      i = j;
    } else {
      out.push({ row: history[i] });
      i++;
    }
  }
  return out;
}

/** Failure text from the farm log, minus the card prefix, the trailing episode tag and a leading ":". */
export function reasonText(detail: string): string {
  return String(detail || "")
    .replace(/^\[[^\]]*\]\s+'[^']*'\s*/, "")
    .replace(/\s+episode=\S+\s*$/, "")
    .replace(/^[\s:;,-]+/, "")
    .trim();
}

// a server or PC path: /Insanity/..., /home/..., C:\...
const PATH = /(?:\(\s*\w+\s+)?(?:\/(?:Insanity|home|opt|srv|tmp|Users|mnt)\/|[A-Za-z]:\\)/;

/**
 * One failure reason split for people: `plain` (never a path, first letter capital) and `details` (the full farm text,
 * only when it says more than `plain`). Both empty when there is no reason.
 */
export function splitReason(text: string): { plain: string; details: string } {
  const full = reasonText(text);
  if (!full) return { plain: "", details: "" };
  const at = full.search(PATH);
  let plain = at < 0 ? full : full.slice(0, at);
  for (let prev = ""; prev !== plain; ) {
    prev = plain;
    plain = plain.replace(/[\s(:,;'"=-]+$/, "").replace(/\s+(?:in|at|from|to|->|path)$/i, "");
  }
  if (!plain) plain = "The render failed";
  plain = plain[0].toUpperCase() + plain.slice(1);
  return { plain, details: at < 0 ? "" : full };
}

/** Reason for a failed card: its own, else its newest failure in the history. "" when the farm recorded none. */
export function failedReason(card: { name: string; kind: string; reason?: string }, history: FarmEvent[]): string {
  if (reasonText(card.reason ?? "")) return card.reason ?? "";
  const fail = history.find((h) => h.type === "FAIL" && h.name === card.name && h.kind === card.kind && reasonText(h.detail));
  return fail ? fail.detail : "";
}

export type PremiereJobLite = { title: string; state: string; held: boolean };
export const PREMIERE_DONE = new Set(["delivered", "cleaned"]);

export type FarmCounts = { needDecision: number; failed: number; onHold: number; nextUp: string | null };

/**
 * Counts for the top line from both queues. A held job counts as on hold only. Next up: After Effects goes first,
 * so the first waiting card, else the first Premiere job that is not held, waiting on a decision or failed.
 */
export function farmCounts(ae: { queue: { name: string }[]; failed: unknown[] } | null, premiere: PremiereJobLite[]): FarmCounts {
  const active = premiere.filter((j) => !PREMIERE_DONE.has(j.state));
  const free = active.filter((j) => !j.held);
  const next = ae?.queue[0]?.name ?? free.find((j) => j.state !== "needs_attention" && j.state !== "failed")?.title.replace(/\.prproj$/i, "");
  return {
    needDecision: free.filter((j) => j.state === "needs_attention").length,
    failed: (ae?.failed.length ?? 0) + free.filter((j) => j.state === "failed").length,
    onHold: active.length - free.length,
    nextUp: next ?? null,
  };
}

const decision = (n: number) => `${n} ${n === 1 ? "needs" : "need"} a decision`;

/** "5 need a decision · 15 failed · 45 on hold · next up: nothing" */
export function topLine(c: FarmCounts): string {
  return [decision(c.needDecision), `${c.failed} failed`, `${c.onHold} on hold`, `next up: ${c.nextUp ?? "nothing"}`].join(" · ");
}

/** Premiere list header, non-zero parts only: "5 need a decision · 45 on hold" ("nothing waiting" when empty). */
export function premiereLine(jobs: PremiereJobLite[]): string {
  const c = farmCounts(null, jobs);
  const waiting = jobs.filter((j) => !PREMIERE_DONE.has(j.state)).length - c.needDecision - c.failed - c.onHold;
  const parts = [c.needDecision && decision(c.needDecision), c.failed && `${c.failed} failed`, c.onHold && `${c.onHold} on hold`, waiting && `${waiting} waiting`];
  return parts.filter(Boolean).join(" · ") || "nothing waiting";
}
