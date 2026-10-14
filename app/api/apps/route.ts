import type { NextRequest } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { sections } from "@/lib/apps";
import { permittedAppIds } from "@/lib/access";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "private, no-store" };

function getPortalBaseUrl(req: NextRequest) {
  const forwardedProto = req.headers.get("x-forwarded-proto");
  const forwardedHost = req.headers.get("x-forwarded-host");

  if (forwardedProto && forwardedHost) {
    return `${forwardedProto}://${forwardedHost}`;
  }

  return process.env.AUTH_URL ? new URL(process.env.AUTH_URL).origin : req.nextUrl.origin;
}

function originOf(url: string) {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/** GET /api/apps — the whole app catalog plus what the signed-in person may open (plan 3.11).
 *  Read-only: unlike /api/me it never upserts the user. `access` uses the same rules as /api/me
 *  and /api/auth/redirect (lib/access.ts), so admins do not get other people's personal apps.
 *  Added for the desktop app; nothing existing calls it, /api/me is unchanged. */
export async function GET(req: NextRequest) {
  const session = await auth();
  const user = session?.user as Record<string, unknown> | undefined;
  const discordId = user?.discordId as string | undefined;

  if (!discordId) {
    return Response.json({ error: "Not authenticated" }, { status: 401, headers: NO_STORE });
  }

  let isAdmin = false;
  let permitted: Set<string>;
  try {
    const dbUser = await prisma.user.findUnique({ where: { discordId }, select: { id: true, isAdmin: true } });
    isAdmin = Boolean(dbUser?.isAdmin) || discordId === process.env.ADMIN_DISCORD_ID;
    // No Portal row yet means no grants: the same answer their first /api/me would give.
    permitted = new Set(await permittedAppIds({ id: dbUser?.id ?? "", isAdmin }, user));
  } catch (err) {
    console.error("[/api/apps] Error:", err);
    // 503 so a client keeps its last good list instead of showing an empty one.
    return Response.json({ error: "Portal is temporarily unavailable" }, { status: 503, headers: NO_STORE });
  }

  const base = getPortalBaseUrl(req);
  return Response.json(
    {
      version: 1,
      user: { discordId, username: (user?.username as string) ?? null, isAdmin },
      sections: sections.map(({ id, name, description, color }) => ({ id, name, description, color })),
      apps: sections.flatMap((section) =>
        section.apps.map((app) => ({
          id: app.id,
          name: app.name,
          description: app.description,
          section: section.id,
          url: app.url,
          origin: originOf(app.url),
          openUrl: `${base}/api/auth/redirect?app=${encodeURIComponent(app.id)}`,
          requiresPortalAuth: app.requiresPortalAuth !== false,
          icon: app.icon,
          color: app.color,
          status: app.status,
          access: permitted.has(app.id),
        })),
      ),
    },
    { headers: NO_STORE },
  );
}
