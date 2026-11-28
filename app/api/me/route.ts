import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { accessMap } from "@/lib/access";
import { applyPendingGrants } from "@/lib/pendingAccess";
import { syncTeamDesk } from "@/lib/teamAccess";
import { isTestDiscordId } from "@/lib/testUsers";

/** GET /api/me — upsert user + return access map */
export async function GET() {
  try {
    const session = await auth();
    const user = session?.user as Record<string, unknown> | undefined;
    const discordId = user?.discordId as string | undefined;

    if (!discordId) {
      return Response.json({ error: "Not authenticated" }, { status: 401 });
    }

    // B0 test users are made by tools/test_users.mjs only: a test session whose row was removed is refused (review S7)
    if (isTestDiscordId(discordId) && !(await prisma.user.findUnique({ where: { discordId }, select: { id: true } }))) {
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

    // pre-grants by email: only for a Discord-verified email (lib/pendingAccess.ts, R-2159 risk 9)
    await applyPendingGrants(dbUser, user);

    // a newcomer on the team sees Desk in the bar straight away (lib/teamAccess.ts; only someone with no Desk row is looked up)
    await syncTeamDesk({ id: dbUser.id, discordId }, { grantOnly: true });

    const accessRows = await prisma.appAccess.findMany({
      where: { userId: dbUser.id, granted: true },
    });

    // one rule for every route (lib/access.ts)
    const access = accessMap({
      discordId,
      user,
      isAdmin: dbUser.isAdmin,
      granted: new Set(accessRows.map((a) => a.appId)),
    });

    return Response.json({ discordId, isAdmin: dbUser.isAdmin, access });
  } catch (err) {
    console.error("[/api/me] Error:", err);
    return Response.json({ error: "Internal error" }, { status: 500 });
  }
}
