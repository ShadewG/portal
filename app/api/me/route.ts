import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { allApps } from "@/lib/apps";

/** GET /api/me — upsert user + return access map */
export async function GET() {
  const session = await auth();
  const user = session?.user as Record<string, unknown> | undefined;
  const discordId = user?.discordId as string | undefined;

  if (!discordId) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  // Upsert user on every /api/me call (happens on dashboard load)
  const username = (user?.username as string) ?? "unknown";
  const avatar = (user?.avatar as string) ?? null;
  const email = (user?.email as string) ?? null;
  const isAdmin = discordId === process.env.ADMIN_DISCORD_ID;

  const dbUser = await prisma.user.upsert({
    where: { discordId },
    update: { username, avatar, email },
    create: { discordId, username, avatar, email, isAdmin },
    include: { access: true },
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
    where: { userId: dbUser.id, granted: true },
  });

  const access: Record<string, boolean> = {};
  for (const app of allApps) {
    if (dbUser.isAdmin) {
      access[app.id] = true;
    } else {
      access[app.id] = accessRows.some((a) => a.appId === app.id);
    }
  }

  return Response.json({ discordId, isAdmin: dbUser.isAdmin, access });
}
