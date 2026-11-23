import { randomBytes, randomInt, timingSafeEqual } from "crypto";

// Signing in the Insanity Desk app through the person's own browser (10 Nov 2026, Samuel: "Lets do sign in outside of
// app possible for discord"). Inside the app's window Discord is never signed in, so signing in there meant Discord's
// password or QR code, then a captcha. Instead:
//   1. the app's window (Portal's /login, Desk 0.24.4 and later) asks POST /api/auth/desktop/start: a sign-in that waits
//      10 minutes, its secret in a cookie only that window has, and a short code the window shows;
//   2. the window opens /api/auth/desktop/approve?id=… and the app sends that address to the default browser, where
//      Discord (often Portal too) is already signed in; the page shows the same code and who will be signed in;
//      "Sign in the app" approves it;
//   3. the window asks GET /api/auth/desktop/poll with its cookie; once approved it gets the same Portal session cookie
//      a sign-in inside the window would have set (the browser session's own claims, a new token), then goes on.
// Kept in this process's memory (globalThis: every route bundle shares it). A restart drops sign-ins in progress: the
// window says so and the person presses the button again. Each one is used once.

export type Pending = {
  id: string;
  secret: string;
  code: string;
  ip: string;
  at: number;
  status: "pending" | "approved" | "cancelled";
  claims?: Record<string, unknown>;
  who?: string;
};

export const TTL_MS = 10 * 60 * 1000;
export const COOKIE = "portal_desk_signin";
export const COOKIE_PATH = "/api/auth/desktop";
export const SESSION_MAX_AGE = 365 * 24 * 60 * 60; // as auth.ts

const g = globalThis as unknown as { __portalDesktopSignin?: Map<string, Pending> };
const store: Map<string, Pending> = (g.__portalDesktopSignin ??= new Map());
const LETTERS = "ACDEFHJKLMNPRTUVWXY3479"; // no 0/O, 1/I, 2/Z, 5/S, 8/B

function sweep() {
  const now = Date.now();
  for (const [k, e] of store) if (now - e.at > TTL_MS) store.delete(k);
}

/** A new sign-in waiting for the browser, or null when this address already has 10 waiting (or 500 in all). */
export function startPending(ip: string): Pending | null {
  sweep();
  if (store.size >= 500) return null;
  let mine = 0;
  for (const e of store.values()) if (e.ip === ip) mine++;
  if (mine >= 10) return null;
  const pick = () => LETTERS[randomInt(LETTERS.length)];
  const code = `${pick()}${pick()}${pick()}-${pick()}${pick()}${pick()}`;
  const e: Pending = { id: randomBytes(18).toString("base64url"), secret: randomBytes(32).toString("base64url"), code, ip, at: Date.now(), status: "pending" };
  store.set(e.id, e);
  return e;
}

export function findPending(id: string | null | undefined): Pending | null {
  sweep();
  return (id && store.get(id)) || null;
}

export function forgetPending(id: string) {
  store.delete(id);
}

/** The window's cookie: "<id>.<secret>" for this sign-in. */
export function ownsPending(cookie: string | undefined): Pending | null {
  const [id, secret] = (cookie ?? "").split(".");
  const e = findPending(id);
  if (!e || !secret) return null;
  const a = Buffer.from(e.secret);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b) ? e : null;
}

/** Portal's cookies are Secure ones whenever it runs on https (AUTH_URL), as Auth.js decides. */
export const secureCookies = () => (process.env.AUTH_URL ?? process.env.NEXTAUTH_URL ?? "https://portal.insanity.team").startsWith("https:");
export const sessionCookieName = () => `${secureCookies() ? "__Secure-" : ""}authjs.session-token`;

/** The address the request came from (Caddy sets X-Forwarded-For). */
export function clientIp(req: Request): string {
  return (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || req.headers.get("x-real-ip") || "unknown";
}

export function escapeHtml(text: string) {
  return text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
}

// same-origin, not no-referrer: with no-referrer the browser sends "Origin: null" on the form's POST and the approve
// route's same-site check refuses the person's own click (seen in the first real try, 10 Nov 2026)
/** A plain page in Portal's sign-in style (as the "Desk is for the Insanity team" page in /api/auth/redirect). */
export function page(title: string, body: string, status = 200) {
  const html =
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="robots" content="noindex"><meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<title>${escapeHtml(title)}</title><style>` +
    `body{margin:0;background:#0a0c0e;color:#eef2f5;font:15px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif}main{max-width:520px;margin:0 auto;padding:12vh 22px 60px}` +
    `.eyebrow{font:600 11px/1 ui-monospace,Consolas,monospace;letter-spacing:.16em;color:#79848e;text-transform:uppercase}h1{font-size:24px;font-weight:650;letter-spacing:-.01em;margin:10px 0 14px}` +
    `p{color:#a7b2bc;margin:0 0 14px}b{color:#eef2f5}.code{display:inline-block;font:700 26px/1 ui-monospace,Consolas,monospace;letter-spacing:.12em;color:#eef2f5;background:#151a1f;border:1px solid #303a44;border-radius:10px;padding:14px 18px;margin:4px 0 18px}` +
    `.warn{border:1px solid #6b5420;background:#1d1708;color:#e9cf8f;border-radius:8px;padding:10px 12px}` +
    `.row{display:flex;flex-wrap:wrap;gap:10px;margin-top:22px}button,a.btn{display:inline-block;padding:11px 18px;border-radius:8px;text-decoration:none;font:600 14px/1.2 inherit;cursor:pointer;border:0}` +
    `.primary{background:#5865f2;color:#fff}.plain{background:transparent;border:1px solid #303a44;color:#eef2f5}</style></head><body><main>` +
    `<div class="eyebrow">Insanity · Desk app</div>${body}</main></body></html>`;
  return new Response(html, { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Frame-Options": "DENY", "Referrer-Policy": "same-origin" } });
}
