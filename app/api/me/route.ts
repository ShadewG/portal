import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { allApps } from "@/lib/apps";
import { FRONTWIND_DUBBING_APP_ID, isFrontwindDubbingAllowed } from "@/lib/frontwindAccess";
import { CASES_DASHBOARD_APP_ID, isCasesDashboardAllowed } from "@/lib/casesAccess";

/** GET /api/me — upsert user + return access map */
export async function GET() {
  try {
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
    const envAdmin = discordId === process.env.ADMIN_DISCORD_ID;

    const dbUser = await prisma.user.upsert({
      where: { discordId },
      update: {
        username,
        avatar,
        email,
        ...(envAdmin ? { isAdmin: true } : {}),
      },
      create: { discordId, username, avatar, email, isAdmin: envAdmin },
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
      const hasAppAccess = accessRows.some((a) => a.appId === app.id);
      if (app.id === CASES_DASHBOARD_APP_ID) {
        access[app.id] = isCasesDashboardAllowed(user);
      } else if (app.id === FRONTWIND_DUBBING_APP_ID) {
        access[app.id] = hasAppAccess && isFrontwindDubbingAllowed(user);
      } else if (dbUser.isAdmin) {
        access[app.id] = true;
      } else {
        access[app.id] = hasAppAccess;
      }
    }

    return Response.json({ discordId, isAdmin: dbUser.isAdmin, access });
  } catch (err) {
    console.error("[/api/me] Error:", err);
    return Response.json({ error: "Internal error" }, { status: 500 });
  }
}
