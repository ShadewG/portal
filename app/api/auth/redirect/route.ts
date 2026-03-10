import { NextRequest } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { getAppById } from "@/lib/apps";
import { signAppToken } from "@/lib/jwt";

function getPortalBaseUrl(req: NextRequest) {
  const forwardedProto = req.headers.get("x-forwarded-proto");
  const forwardedHost = req.headers.get("x-forwarded-host");

  if (forwardedProto && forwardedHost) {
    return `${forwardedProto}://${forwardedHost}`;
  }

  return process.env.AUTH_URL ?? req.nextUrl.origin;
}

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
    const loginUrl = new URL("/login", getPortalBaseUrl(req));
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

  if (dbUser.email) {
    const pending = await prisma.pendingAppAccess.findMany({
      where: { email: dbUser.email, granted: true, resolvedAt: null },
    });

    if (pending.length > 0) {
      await prisma.$transaction([
        ...pending.map((row) =>
          prisma.appAccess.upsert({
            where: { userId_appId: { userId: dbUser.id, appId: row.appId } },
            update: { granted: true },
            create: { userId: dbUser.id, appId: row.appId, granted: true },
          })
        ),
        prisma.pendingAppAccess.updateMany({
          where: { id: { in: pending.map((row) => row.id) } },
          data: { resolvedAt: new Date(), resolvedUserId: dbUser.id },
        }),
      ]);
    }
  }

  const accessRows = await prisma.appAccess.findMany({
    where: { userId: dbUser.id, appId, granted: true },
  });

  const isAdmin = dbUser.isAdmin || envAdmin;
  const hasAccess = isAdmin || accessRows.length > 0;

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
    avatar: user?.avatar as string | undefined,
    isAdmin,
    appId,
    appUserId: link?.externalUserId ?? undefined,
  });

  // Redirect to target app with token
  const targetUrl = buildTargetUrl(baseUrl, app.handoffPath, next);
  targetUrl.searchParams.set("portal_token", token);

  return Response.redirect(targetUrl.toString(), 302);
}
