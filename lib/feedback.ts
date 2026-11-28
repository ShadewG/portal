// No "@/" imports: tools/x6_feedback_test.mjs loads this file on its own (node --experimental-strip-types).
import { appendFile, mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";

/**
 * "This is confusing" notes from Portal Home and /access (plan R-3258 X6, S5, 28 Nov 2026).
 * POST /api/feedback {text, page, tab}. The person comes from the Portal session, never from the body. One JSON line per
 * note in <PORTAL_FEEDBACK_DIR>/portal-feedback-YYYY-MM.jsonl (UTC month), mode 600; the hub copies new lines into
 * Mission Control (scripts/feedback_ingest.py). The text is untrusted data: stored cleaned, never rendered as HTML.
 * Limits: body 2 KB; per person 5 notes in 10 minutes and 20 a day; all people 300 a day (in memory, one process).
 * Same line shape as the Pulse notes (insanity-workspace feedback.mjs), so one hub script reads both.
 */
export const FEEDBACK_MAX_BODY = 2048;
export const FEEDBACK_MIN = 3;
export const FEEDBACK_MAX = 300;
export const FEEDBACK_PAGES = new Set(["/", "/access"]);

export function cleanFeedbackText(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩﻿]/g, " ").replace(/\s+/g, " ").trim();
  return t.length >= FEEDBACK_MIN && t.length <= FEEDBACK_MAX ? t : null;
}
/** The sub-tab label shown on the page (e.g. "People", "History"): letters, digits, spaces, 40 max; else null. */
export function cleanTab(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.replace(/\s+/g, " ").trim().slice(0, 40);
  return /^[A-Za-z0-9 ()&'-]+$/.test(t) ? t : null;
}

export interface FeedbackWho { discordId: string; username: string | null; name: string | null }
export interface FeedbackResult { status: number; error?: string }
interface Fs { appendFile: typeof appendFile; mkdir: typeof mkdir }

export function createFeedback({ dir, now = () => new Date(), log = console.error, fs = { appendFile, mkdir } as Fs,
  per10m = 5, perDay = 20, allDay = 300 }: { dir: string; now?: () => Date; log?: (...a: unknown[]) => void; fs?: Fs;
  per10m?: number; perDay?: number; allDay?: number }) {
  const recent = new Map<string, number[]>();
  let day = "", all = 0;
  return {
    async take(who: FeedbackWho | null, body: Record<string, unknown>): Promise<FeedbackResult> {
      if (!dir) return { status: 503, error: "Notes are not switched on here." };
      if (!who?.discordId) return { status: 401, error: "Sign in first." };
      const text = cleanFeedbackText(body.text);
      if (!text) return { status: 400, error: `Write ${FEEDBACK_MIN} to ${FEEDBACK_MAX} characters.` };
      const page = typeof body.page === "string" && FEEDBACK_PAGES.has(body.page) ? body.page : "other";
      const d = now(), ms = d.getTime(), today = d.toISOString().slice(0, 10);
      if (today !== day) { day = today; all = 0; }
      const mine = (recent.get(who.discordId) ?? []).filter((t) => ms - t < 86400e3);
      if (mine.length >= perDay || mine.filter((t) => ms - t < 600e3).length >= per10m || all >= allDay) {
        recent.set(who.discordId, mine);
        return { status: 429, error: "You sent several notes just now. Try again later." };
      }
      const line = JSON.stringify({ v: 1, id: randomUUID(), t: d.toISOString(), app: "portal", page, tab: cleanTab(body.tab),
        role: null, who: { portalUserId: null, discordId: who.discordId, username: who.username?.slice(0, 64) ?? null,
          name: who.name?.slice(0, 80) ?? null }, text }) + "\n";
      try {
        await fs.mkdir(dir, { recursive: true, mode: 0o700 });
        await fs.appendFile(path.join(dir, `portal-feedback-${today.slice(0, 7)}.jsonl`), line, { mode: 0o600 });
      } catch (e) {
        log("[/api/feedback] write failed", (e as { code?: string })?.code ?? "-");
        return { status: 503, error: "Not saved. Try again." };
      }
      mine.push(ms); recent.set(who.discordId, mine); all++;
      if (recent.size > 5000) for (const [k, v] of recent) if (!v.some((t) => ms - t < 86400e3)) recent.delete(k);
      return { status: 204 };
    },
  };
}
