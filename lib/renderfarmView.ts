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
// The PC may also write Windows' own formats with no zone: Norwegian "27.11.2026 12:42:11" (day first) and US
// "11/27/2026 12:42:11" (month first, as its bootedAt). Both are read as wall-clock times in the farm's zone too.
const WALL_NO = /^(\d{1,2})\.(\d{1,2})\.(\d{4})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?$/;
const WALL_US = /^(\d{1,2})\/(\d{1,2})\/(\d{4})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s*([AP]M))?$/i;

/** [y, mo, d, h, mi, s, ms] of a zone-less wall-clock time, or null */
function wallParts(s: string): number[] | null {
  let m = WALL.exec(s);
  if (m) return [+m[1], +m[2], +m[3], +m[4], +m[5], +(m[6] ?? 0), Math.round(Number(m[7] ?? 0) * 1000)];
  m = WALL_NO.exec(s);
  if (m) return [+m[3], +m[2], +m[1], +m[4], +m[5], +(m[6] ?? 0), 0];
  m = WALL_US.exec(s);
  if (m) {
    let h = +m[4];
    if (m[7]) h = (h % 12) + (/p/i.test(m[7]) ? 12 : 0);
    return [+m[3], +m[1], +m[2], h, +m[5], +(m[6] ?? 0), 0];
  }
  return null;
}

/**
 * Milliseconds since 1970 for a farm time. Times with Z or an offset are taken as they are; times without one are
 * wall-clock times in `zone` (default Europe/Oslo). Across the autumn change the repeated hour reads as the later
 * (winter) one; a spring time that never existed moves one hour on. NaN when it is not a time.
 */
export function parseFarmTime(ts: string | null | undefined, zone?: string): number {
  const s = String(ts ?? "").trim();
  const w = wallParts(s);
  if (!w) return s ? Date.parse(s) : NaN;
  if (w[1] < 1 || w[1] > 12 || w[2] < 1 || w[2] > 31 || w[3] > 23 || w[4] > 59 || w[5] > 59) return NaN;
  const z = validZone(zone);
  const guess = Date.UTC(w[0], w[1] - 1, w[2], w[3], w[4], w[5], w[6]);
  const first = offsetAt(guess, z);
  let t = guess - first;
  const second = offsetAt(t, z);
  if (second !== first) t = guess - second;
  return t;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad = (n: number) => String(n).padStart(2, "0");

/** "18:40" today, "27 Nov, 18:40" on other days, "27 Nov 2025, 18:40" in another year, in the viewer's zone (or `zone`). "" when not a time. */
export function fmtWhen(ms: number, now = Date.now(), zone?: string): string {
  if (!Number.isFinite(ms)) return "";
  const p = parts(ms, zone);
  const n = parts(now, zone);
  const time = `${pad(p.h)}:${pad(p.mi)}`;
  if (p.y === n.y && p.mo === n.mo && p.d === n.d) return time;
  return `${p.d} ${MONTHS[p.mo - 1]}${p.y === n.y ? "" : ` ${p.y}`}, ${time}`;
}

/** "11:33-11:44" (date first when not today, and on both ends when the days differ); one end only when the other is not a time */
export function fmtRange(from: number, to: number, now = Date.now(), zone?: string): string {
  const a = fmtWhen(from, now, zone);
  const b = fmtWhen(to, now, zone);
  if (!a || !b) return a || b;
  if (a === b) return a;
  const day = (s: string) => (s.includes(", ") ? s.split(", ")[0] : "");
  return day(a) === day(b) && day(a) ? `${a}-${b.split(", ")[1]}` : `${a}-${b}`;
}

export type FarmEvent = { timestamp: string; type: string; label: string; name: string; kind: string; episode: string; detail: string };
/** one distinct failure reason inside a folded run: the newest farm line with that reason, and how often it came */
export type RunReason = { detail: string; count: number };
export type ActivityItem =
  | { row: FarmEvent }
  | { repeat: { name: string; kind: string; episode: string; fails: number; from: string; to: string; last: FarmEvent; earlier: RunReason[] } };

/**
 * Activity list with retry loops folded: a run of one card's rows in a row (newest first, same name, kind and
 * episode) that holds 2 or more failures becomes one item ("A_DOC-3 failed 11 times, 11:33-11:44"). A finished render
 * ends a run. The range ends at the newest failure. `last` is the newest failure; `earlier` lists each other reason
 * of the run once, newest first, with its count, so no reason is hidden by the fold.
 */
export function collapseActivity(history: FarmEvent[]): ActivityItem[] {
  const out: ActivityItem[] = [];
  const same = (a: FarmEvent, b: FarmEvent) => a.name === b.name && a.kind === b.kind && a.episode === b.episode;
  const finished = (h: FarmEvent) => h.type === "DONE" || h.type === "DONE-WITH-NOTES";
  for (let i = 0; i < history.length; ) {
    let j = i;
    while (j < history.length && same(history[j], history[i]) && !finished(history[j])) j++;
    const run = history.slice(i, j);
    const fails = run.filter((h) => h.type === "FAIL");
    if (fails.length >= 2) {
      const key = (detail: string) => reasonText(detail).toLowerCase();
      const earlier: RunReason[] = [];
      for (const f of fails) {
        if (key(f.detail) === key(fails[0].detail)) continue;
        const e = earlier.find((x) => key(x.detail) === key(f.detail));
        if (e) e.count++;
        else earlier.push({ detail: f.detail, count: 1 });
      }
      out.push({ repeat: { name: run[0].name, kind: run[0].kind, episode: run[0].episode, fails: fails.length, from: run[run.length - 1].timestamp, to: fails[0].timestamp, last: fails[0], earlier } });
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

// a server or PC path or a link: /Insanity/..., /Volumes/..., any /word/word, C:\... or D:/..., \\PC\share, http(s)://...
const PATH = /(?:\(\s*\w+\s+)?(?:(?:^|(?<=[\s('"=]))\/[^\s/]+\/|[A-Za-z]:[\\/]|\\\\|https?:\/\/)/i;

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

/**
 * Reason for a failed card: its own, else its newest failure in the history for the same card name, kind AND episode
 * (card names like A_PC_1 repeat in every episode). "" when the farm recorded none.
 */
export function failedReason(card: { name: string; kind: string; episode: string; reason?: string }, history: FarmEvent[]): string {
  if (reasonText(card.reason ?? "")) return card.reason ?? "";
  const fail = history.find((h) => h.type === "FAIL" && h.name === card.name && h.kind === card.kind && h.episode === card.episode && reasonText(h.detail));
  return fail ? fail.detail : "";
}

export type PremiereJobLite = { title: string; state: string; held: boolean; working?: boolean };
export const PREMIERE_DONE = new Set(["delivered", "cleaned"]);
/** pfarm states of a job that has not started rendering yet (cli.py NEXT); rendering, rendered and compared are in progress */
export const PREMIERE_WAITING = new Set(["queued", "planned", "syncing", "ready"]);

export type FarmCounts = { needDecision: number; failed: number; onHold: number; nextUp: string | null };

/**
 * Counts for the top line from both queues. A held job counts as on hold only. Next up: After Effects goes first,
 * so the first waiting card, else the first Premiere job that is still waiting (queued, planned, syncing, ready),
 * not held and not being worked on right now.
 */
export function farmCounts(ae: { queue: { name: string }[]; failed: unknown[] } | null, premiere: PremiereJobLite[]): FarmCounts {
  const active = premiere.filter((j) => !PREMIERE_DONE.has(j.state));
  const free = active.filter((j) => !j.held);
  const next = ae?.queue[0]?.name ?? free.find((j) => PREMIERE_WAITING.has(j.state) && !j.working)?.title.replace(/\.prproj$/i, "");
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
  const waiting = jobs.filter((j) => !j.held && PREMIERE_WAITING.has(j.state)).length;
  const parts = [c.needDecision && decision(c.needDecision), c.failed && `${c.failed} failed`, c.onHold && `${c.onHold} on hold`, waiting && `${waiting} waiting`];
  return parts.filter(Boolean).join(" · ") || "nothing waiting";
}

/** a Notion card link, only when it is one (https://www.notion.so/..., https://notion.so/..., https://<x>.notion.site/...) */
export function notionHref(url: string | null | undefined): string | undefined {
  const u = String(url ?? "");
  return /^https:\/\/(?:www\.)?notion\.so\//i.test(u) || /^https:\/\/[a-z0-9-]+\.notion\.site\//i.test(u) ? u : undefined;
}

/**
 * An action's error for the notice line: the server's words without any address, port, link or path (the PC's
 * address must not reach the browser). Falls back to "That did not work (HTTP 502). Try again in a minute."
 */
export function noticeText(error: unknown, status: number): string {
  let s = typeof error === "string" ? error : "";
  const cut = s.search(/[a-z][a-z0-9+.-]*:\/\/|\\\\|\b[A-Za-z]:[\\/]|(?:^|(?<=[\s('"=]))\/[^\s/]+\/|\blocalhost\b|\b\d{1,3}(?:\.\d{1,3}){3}\b|\b[\w-]+(?:\.[\w-]+)*\.ts\.net\b|:\d{2,5}\b/i);
  if (cut >= 0) s = s.slice(0, cut);
  s = s.replace(/[\s:,;(\[-]+$/, "").trim().slice(0, 140);
  return /[A-Za-z]{3}/.test(s) ? s : `That did not work (HTTP ${status}). Try again in a minute.`;
}
