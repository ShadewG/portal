import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { portalOrigin } from "@/lib/portalOrigin";
import { clientIp, escapeHtml, findPending, page, secureCookies } from "@/lib/desktopSignin";

// The browser's half of signing in the Desk app (lib/desktopSignin.ts). The app opens this address in the default
// browser. Not signed in to Portal there: the normal Discord sign-in first (one click when Discord is signed in), back
// here after. Then one page: who will be signed in, the code the app shows, Sign in the app / Cancel (a form POST).

const again = "Go back to Insanity Desk and press <b>Sign in with your browser</b> again.";

async function browserToken(req: NextRequest) {
  const secret = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET;
  if (!secret) return null;
  return (await getToken({ req, secret, secureCookie: secureCookies() })) as Record<string, unknown> | null;
}

function toLogin(origin: string, id: string) {
  const back = `/api/auth/desktop/approve?id=${encodeURIComponent(id)}`;
  return NextResponse.redirect(`${origin}/login?callbackUrl=${encodeURIComponent(back)}`);
}

const nameOf = (t: Record<string, unknown>) => String(t.globalName || t.username || t.name || "your Discord account");

export async function GET(req: NextRequest) {
  const origin = portalOrigin(req);
  const id = req.nextUrl.searchParams.get("id") ?? "";
  const e = findPending(id);
  if (!e) return page("Sign-in link expired", `<h1>This sign-in link has expired</h1><p>Links from the app work for 10 minutes, once. ${again}</p>`, 410);
  if (e.status !== "pending") return page("Already used", `<h1>This sign-in was already answered</h1><p>${again}</p>`, 409);
  const t = await browserToken(req);
  if (!t) return toLogin(origin, id);
  const who = escapeHtml(nameOf(t));
  const user = t.username && t.globalName && t.username !== t.globalName ? ` (${escapeHtml(String(t.username))})` : "";
  const otherNet = e.ip !== "unknown" && e.ip !== clientIp(req);
  const body =
    `<h1>Sign in Insanity Desk as ${who}?</h1>` +
    `<p>The Insanity Desk app on your computer will be signed in with the Discord account <b>${who}</b>${user}.</p>` +
    `<p>Check that the app shows this code:</p><div class="code">${escapeHtml(e.code)}</div>` +
    (otherNet ? `<p class="warn">The app asking is on a different network from this browser. Only continue if you just pressed <b>Sign in with your browser</b> in Insanity Desk yourself.</p>` : "") +
    `<form method="post" class="row"><input type="hidden" name="id" value="${escapeHtml(e.id)}">` +
    `<button class="primary" name="do" value="yes" type="submit">Sign in the app</button>` +
    `<button class="plain" name="do" value="no" type="submit">Cancel</button></form>` +
    `<p style="margin-top:22px;font-size:13px">Not you? <a style="color:#a7b2bc" href="${origin}/api/auth/signout?callbackUrl=${encodeURIComponent(`/api/auth/desktop/approve?id=${e.id}`)}">Use a different Discord account</a></p>`;
  return page("Sign in Insanity Desk", body);
}

export async function POST(req: NextRequest) {
  const origin = portalOrigin(req);
  // a form on this page only (a page elsewhere cannot approve for the person)
  if (req.headers.get("origin") !== origin) return page("Not allowed", `<h1>That did not come from Portal</h1><p>${again}</p>`, 403);
  const form = await req.formData().catch(() => null);
  const id = String(form?.get("id") ?? "");
  const answer = String(form?.get("do") ?? "");
  const e = findPending(id);
  if (!e) return page("Sign-in link expired", `<h1>This sign-in link has expired</h1><p>${again}</p>`, 410);
  if (e.status !== "pending") return page("Already used", `<h1>This sign-in was already answered</h1><p>${again}</p>`, 409);
  const t = await browserToken(req);
  if (!t) return toLogin(origin, id);
  if (answer !== "yes") {
    e.status = "cancelled";
    return page("Cancelled", `<h1>Cancelled</h1><p>Nothing was signed in. You can close this tab.</p>`);
  }
  const { iat, exp, jti, ...claims } = t; // a new token for the app: its own times
  void iat; void exp; void jti;
  e.claims = claims;
  e.who = nameOf(t);
  e.status = "approved";
  const who = escapeHtml(e.who);
  return page(
    "Insanity Desk is signed in",
    `<h1>Done. Insanity Desk is signing in as ${who}.</h1><p>You can close this tab and go back to the app.</p>` +
      `<div class="row"><a class="btn primary" href="insanitydesk://open">Back to Insanity Desk</a></div>` +
      `<script>setTimeout(function(){location.href="insanitydesk://open"},400)</script>`,
  );
}
