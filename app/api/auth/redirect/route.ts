import { NextRequest } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { getAppById } from "@/lib/apps";
import { signAppToken } from "@/lib/jwt";
import { appAllowed, grantedIds, permittedAppIds } from "@/lib/access";
import { applyPendingGrants } from "@/lib/pendingAccess";
import { portalOrigin } from "@/lib/portalOrigin";
import { syncTeamDesk, type TeamCheck } from "@/lib/teamAccess";

function resolveReturnTo(appUrl: string, allowedOrigins: string[] | undefined, returnTo: string | null) {
  if (!returnTo) return null;
  try {
    const candidate = new URL(returnTo);
    const defaultOrigin = new URL(appUrl).origin;
    const allowed = new Set(allowedOrigins ?? [defaultOrigin]);
    return allowed.has(candidate.origin) ? candidate : null;
  } catch {
    return null;
  }
}

// Desk is for the team (2 Nov 2026, lib/teamAccess.ts): someone signed in with a Discord account that is not on the
// team gets a plain page saying so — what to do, try again, or switch account — never a bare "Access denied".
function escapeHtml(text: string) {
  return text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
}
function teamOnlyPage(origin: string, username: string, team: TeamCheck | null) {
  const again = `${origin}/api/auth/redirect?app=desk`;
  const unsure = !team?.known;
  const text = unsure
    ? "We couldn't check the team's Discord server just now. Wait a minute and try again."
    : `You're signed in with the Discord account <b>${escapeHtml(username)}</b>. Desk and Production open for everyone on the Insanity team's Discord server who has a team role (Editor, Junior, Senior, Writing, FOIA and the like). This account doesn't have one.`;
  const html =
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="robots" content="noindex"><meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<title>Desk is for the Insanity team</title><style>` +
    `body{margin:0;background:#0a0c0e;color:#eef2f5;font:15px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif}main{max-width:560px;margin:0 auto;padding:12vh 22px 60px}` +
    `.eyebrow{font:600 11px/1 ui-monospace,Consolas,monospace;letter-spacing:.16em;color:#79848e;text-transform:uppercase}h1{font-size:24px;font-weight:650;letter-spacing:-.01em;margin:10px 0 14px}` +
    `p{color:#a7b2bc;margin:0 0 14px}b{color:#eef2f5}.row{display:flex;flex-wrap:wrap;gap:10px;margin-top:22px}a.btn{display:inline-block;padding:10px 16px;border-radius:8px;text-decoration:none;font-weight:600}` +
    `a.primary{background:#5865f2;color:#fff}a.plain{border:1px solid #303a44;color:#eef2f5}</style></head><body><main>` +
    `<div class="eyebrow">Insanity · Desk</div><h1>Desk is for the Insanity team</h1><p>${text}</p>` +
    (unsure ? "" : `<p>On the team? Ask your lead to give you your team role on Discord, then sign in again. Signed in with the wrong Discord account? Sign out and sign in with the right one.</p>`) +
    `<div class="row"><a class="btn primary" href="${again}">Try again</a>` +
    `<a class="btn plain" href="${origin}/api/auth/signout?callbackUrl=${encodeURIComponent(again)}">Use a different Discord account</a>` +
    `<a class="btn plain" href="${origin}/">Back to Portal</a></div></main></body></html>`;
  return new Response(html, { status: 403, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}

function buildTargetUrl(baseUrl: string, handoffPath: string | undefined, next: string | null) {
  const targetUrl = new URL(baseUrl);
  const preservedNext = next ?? (handoffPath && targetUrl.pathname && targetUrl.pathname !== '/' ? `${targetUrl.pathname}${targetUrl.search}` : null);
  if (handoffPath) {
    targetUrl.pathname = handoffPath;
    targetUrl.search = '';
  }
  if (preservedNext) {
    targetUrl.searchParams.set("next", preservedNext);
  }
  return targetUrl;
}

/** GET /api/auth/redirect?app=script-reviewer
 *  Validates user has access, generates a signed JWT, redirects to the target app. */
export async function GET(req: NextRequest) {
  const appId = req.nextUrl.searchParams.get("app");
  if (!appId) {
    return Response.json({ error: "Missing app parameter" }, { status: 400 });
  }

  const app = getAppById(appId);
  if (!app) {
    return Response.json({ error: "Unknown app" }, { status: 404 });
  }

  const returnTo = req.nextUrl.searchParams.get("returnTo");
  const next = req.nextUrl.searchParams.get("next");
  const safeReturnTo = resolveReturnTo(app.url, app.allowedOrigins, returnTo);
  const baseUrl = safeReturnTo?.toString() ?? app.url;
  const requiresPortalAuth = app.requiresPortalAuth !== false;

  if (!requiresPortalAuth) {
    const targetUrl = buildTargetUrl(baseUrl, app.handoffPath, next);
    return Response.redirect(targetUrl.toString(), 302);
  }

  const session = await auth();
  const user = session?.user as Record<string, unknown> | undefined;
  const discordId = user?.discordId as string | undefined;

  if (!discordId) {
    const loginUrl = new URL("/login", portalOrigin(req));
    const callbackUrl = `${req.nextUrl.pathname}${req.nextUrl.search}`;
    loginUrl.searchParams.set("callbackUrl", callbackUrl);
    return Response.redirect(loginUrl.toString(), 302);
  }

  const username = (user?.username as string) ?? "unknown";
  const avatar = (user?.avatar as string) ?? null;
  const email = (user?.email as string) ?? null;
  const envAdmin = discordId === process.env.ADMIN_DISCORD_ID;

  const dbUser = await prisma.user.upsert({
    where: { discordId },
    update: { username, avatar, email },
    create: { discordId, username, avatar, email, isAdmin: envAdmin },
  });

  // pre-grants by email: only for a Discord-verified email (lib/pendingAccess.ts, R-2159 risk 9)
  await applyPendingGrants(dbUser, user);

  // Desk + Production: the team rule grants or turns off this person's Desk grant first (lib/teamAccess.ts)
  const team = appId === "desk" ? await syncTeamDesk({ id: dbUser.id, discordId }) : null;

  const isAdmin = dbUser.isAdmin || envAdmin;
  // one rule for every route (lib/access.ts)
  const hasAccess = appAllowed(app, { discordId, user, isAdmin, granted: await grantedIds(dbUser.id) });

  if (!hasAccess && appId === "desk") return teamOnlyPage(portalOrigin(req), username, team);
  if (!hasAccess) {
    return new Response("Access denied. Contact an admin to request access.", {
      status: 403,
      headers: { "Content-Type": "text/plain" },
    });
  }

  const link = await prisma.appUserLink.findUnique({
    where: { userId_appId: { userId: dbUser.id, appId } },
  });

  const token = signAppToken({
    portalUserId: dbUser.id,
    discordId,
    email: user?.email as string | undefined,
    username: user?.username as string | undefined,
    // Desk: their current Discord picture (the server's answer) over the one from their last Discord login
    avatar: (team?.known && team.avatar) || (user?.avatar as string | undefined),
    isAdmin,
    appId,
    appUserId: link?.externalUserId ?? undefined,
    // Desk is the employee home: it lists the person's tools, so it gets the permitted app ids.
    // Video Review (13 Nov 2026): sends someone Portal lets into FOIA Sorter on to the Sorter's own sign-in
    apps: appId === "desk" || appId === "video-review" ? await permittedAppIds({ id: dbUser.id, isAdmin }, user) : undefined,
    // Desk names a newcomer by the name the team knows on Discord (their server nickname) when its directory has none
    name: team?.known && team.name ? team.name : undefined,
  });

  // Redirect to target app with token
  const targetUrl = buildTargetUrl(baseUrl, app.handoffPath, next);
  targetUrl.searchParams.set("portal_token", token);

  return Response.redirect(targetUrl.toString(), 302);
}
