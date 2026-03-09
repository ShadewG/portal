import { NextRequest } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { getAppById } from "@/lib/apps";
import { signAppToken } from "@/lib/jwt";

/** GET /api/auth/redirect?app=script-reviewer
 *  Validates user has access, generates a signed JWT, redirects to the target app. */
export async function GET(req: NextRequest) {
  const session = await auth();
  const user = session?.user as Record<string, unknown> | undefined;
  const discordId = user?.discordId as string | undefined;

  if (!discordId) {
    const loginUrl = new URL("/login", req.nextUrl);
    const callbackUrl = `${req.nextUrl.pathname}${req.nextUrl.search}`;
    loginUrl.searchParams.set("callbackUrl", callbackUrl);
    return Response.redirect(loginUrl.toString(), 302);
  }

  const appId = req.nextUrl.searchParams.get("app");
  if (!appId) {
    return Response.json({ error: "Missing app parameter" }, { status: 400 });
  }

  const app = getAppById(appId);
  if (!app) {
    return Response.json({ error: "Unknown app" }, { status: 404 });
  }

  // Check access
  const dbUser = await prisma.user.findUnique({
    where: { discordId },
    include: { access: { where: { appId, granted: true } } },
  });

  const isAdmin = dbUser?.isAdmin ?? discordId === process.env.ADMIN_DISCORD_ID;
  const hasAccess = isAdmin || (dbUser?.access?.length ?? 0) > 0;

  if (!hasAccess) {
    return new Response("Access denied. Contact an admin to request access.", {
      status: 403,
      headers: { "Content-Type": "text/plain" },
    });
  }

  const token = signAppToken({
    portalUserId: dbUser!.id,
    discordId,
    email: user?.email as string | undefined,
    username: user?.username as string | undefined,
    avatar: user?.avatar as string | undefined,
    isAdmin,
    appId,
    appUserId: undefined,
  });

  // Redirect to target app with token
  const targetUrl = new URL(app.url);
  if (app.handoffPath) {
    targetUrl.pathname = app.handoffPath;
  }
  targetUrl.searchParams.set("portal_token", token);

  return Response.redirect(targetUrl.toString(), 302);
}
