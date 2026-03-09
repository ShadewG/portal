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
    return Response.json({ error: "Not authenticated" }, { status: 401 });
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
    discordId,
    email: user?.email as string | undefined,
    username: user?.username as string | undefined,
    appId,
  });

  // Redirect to target app with token
  const targetUrl = new URL(app.url);
  targetUrl.searchParams.set("portal_token", token);

  return Response.redirect(targetUrl.toString(), 302);
}
