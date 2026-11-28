import { NextRequest } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { isPortalAdmin } from "@/lib/admin";
import { allApps } from "@/lib/apps";
import { accessErrorStatus, setGrants } from "@/lib/accessChanges";
import { isOwner } from "@/lib/access";
import { maskEmail } from "@/lib/accessAdmin";

/** GET /api/admin: list all users with their access. Portal admins (read). Emails, Discord ids and avatars go to the
 *  owner only (same privacy rule as /access, R-2159 M3): others get a masked email, discordId "" and avatar null. */
export async function GET() {
  const session = await auth();
  if (!(await isPortalAdmin(session))) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  const owner = isOwner((session?.user as Record<string, unknown> | undefined)?.discordId);

  const users = await prisma.user.findMany({
    include: { access: true },
    orderBy: { createdAt: "asc" },
  });

  const result = users.map((u) => ({
    id: u.id,
    discordId: owner ? u.discordId : "",
    username: u.username,
    avatar: owner ? u.avatar : null,
    email: owner || !u.email ? u.email : maskEmail(u.email),
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

/** PATCH /api/admin: toggle access: { userId, appId, granted }. Through lib/accessChanges.ts setGrants (catalog check
 *  + audit): the owner and access admins only (X3, 28 Nov 2026); other Portal admins get 403 "look but not change". */
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
    const result = await setGrants(actor, userId, [{ grantId: appId, granted }], "admin page");
    return Response.json({ ok: true, changeId: result.changeId });
  } catch (err) {
    const status = accessErrorStatus(err);
    if (status === 500) console.error("[/api/admin PATCH] Error:", String(err));
    return Response.json({ error: status === 500 ? "Internal error" : (err as Error).message }, { status });
  }
}
