import { NextRequest } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { isPortalAdmin } from "@/lib/admin";
import { allApps } from "@/lib/apps";
import { accessErrorStatus, setGrants } from "@/lib/accessChanges";

/** GET /api/admin — list all users with their access */
export async function GET() {
  const session = await auth();
  if (!(await isPortalAdmin(session))) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const users = await prisma.user.findMany({
    include: { access: true },
    orderBy: { createdAt: "asc" },
  });

  const result = users.map((u) => ({
    id: u.id,
    discordId: u.discordId,
    username: u.username,
    avatar: u.avatar,
    email: u.email,
    isAdmin: u.isAdmin,
    createdAt: u.createdAt,
    access: Object.fromEntries(
      allApps.map((app) => {
        const entry = u.access.find((a) => a.appId === app.id);
        return [app.id, entry?.granted ?? false];
      })
    ),
  }));

  return Response.json(result);
}

/** PATCH /api/admin: toggle access: { userId, appId, granted }
 *  Any Portal admin, as before, for app grants; through lib/accessChanges.ts setGrants (catalog check + audit).
 *  Tab grants (dotted ids) need the owner or an access admin; nobody but the owner changes the owner's or their own. */
export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (!(await isPortalAdmin(session))) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const { userId, appId, granted } = (body ?? {}) as { userId?: unknown; appId?: unknown; granted?: unknown };
  if (!userId || typeof userId !== "string" || !appId || typeof appId !== "string" || typeof granted !== "boolean") {
    return Response.json({ error: "Invalid payload" }, { status: 400 });
  }

  const sessionUser = session?.user as Record<string, unknown> | undefined;
  const actor = { discordId: String(sessionUser?.discordId ?? ""), username: (sessionUser?.username as string) ?? null };
  try {
    const result = await setGrants(actor, userId, [{ grantId: appId, granted }], "admin page", { allowPortalAdmin: true });
    return Response.json({ ok: true, changeId: result.changeId });
  } catch (err) {
    const status = accessErrorStatus(err);
    if (status === 500) console.error("[/api/admin PATCH] Error:", String(err));
    return Response.json({ error: status === 500 ? "Internal error" : (err as Error).message }, { status });
  }
}
