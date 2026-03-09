import { NextRequest } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { allApps } from "@/lib/apps";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function isAdmin(session: any) {
  const discordId = (session?.user as Record<string, unknown> | undefined)?.discordId as string | undefined;
  if (!discordId) return false;
  if (discordId === process.env.ADMIN_DISCORD_ID) return true;
  const user = await prisma.user.findUnique({ where: { discordId } });
  return user?.isAdmin ?? false;
}

/** GET /api/admin — list all users with their access */
export async function GET() {
  const session = await auth();
  if (!(await isAdmin(session))) {
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

/** PATCH /api/admin — toggle access: { userId, appId, granted } */
export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (!(await isAdmin(session))) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const { userId, appId, granted } = await req.json();
  if (!userId || !appId || typeof granted !== "boolean") {
    return Response.json({ error: "Invalid payload" }, { status: 400 });
  }

  const adminDiscordId = (session?.user as Record<string, unknown>)?.discordId as string;

  await prisma.appAccess.upsert({
    where: { userId_appId: { userId, appId } },
    update: { granted, grantedBy: adminDiscordId },
    create: { userId, appId, granted, grantedBy: adminDiscordId },
  });

  return Response.json({ ok: true });
}
