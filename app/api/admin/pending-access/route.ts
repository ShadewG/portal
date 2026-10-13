import { NextRequest } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function isAdmin(session: any) {
  const user = (session?.user as Record<string, unknown> | undefined) ?? undefined;
  const discordId = user?.discordId as string | undefined;
  const email = user?.email as string | undefined;
  const username = (user?.username as string | undefined) ?? (user?.name as string | undefined);

  if (!discordId) {
    console.error("[/api/admin/pending-access] isAdmin: missing discordId on session user", user ?? null);
  }
  if (discordId && discordId === process.env.ADMIN_DISCORD_ID) {
    console.error("[/api/admin/pending-access] isAdmin: matched env admin", discordId);
    return true;
  }

  const dbUser = await prisma.user.findFirst({
    where: {
      OR: [
        ...(discordId ? [{ discordId }] : []),
        ...(email ? [{ email }] : []),
        ...(username ? [{ username }] : []),
      ],
    },
  });

  console.error("[/api/admin/pending-access] isAdmin: db lookup", {
    discordId: discordId ?? null,
    email: email ?? null,
    username: username ?? null,
    dbDiscordId: dbUser?.discordId ?? null,
    dbIsAdmin: dbUser?.isAdmin ?? null,
  });

  if (!dbUser) {
    return false;
  }
  return dbUser.isAdmin ?? false;
}

export async function GET() {
  const session = await auth();
  if (!(await isAdmin(session))) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const pending = await prisma.pendingAppAccess.findMany({
    orderBy: { createdAt: "desc" },
  });

  return Response.json(pending);
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!(await isAdmin(session))) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const { email, appId, granted } = await req.json();
  if (!email || !appId || typeof granted !== "boolean") {
    return Response.json({ error: "Invalid payload" }, { status: 400 });
  }

  const adminDiscordId = (session?.user as Record<string, unknown>)?.discordId as string;

  await prisma.pendingAppAccess.upsert({
    where: { email_appId: { email, appId } },
    update: { granted, grantedBy: adminDiscordId },
    create: { email, appId, granted, grantedBy: adminDiscordId },
  });

  return Response.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const session = await auth();
  if (!(await isAdmin(session))) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const { email, appId } = await req.json();
  if (!email || !appId) {
    return Response.json({ error: "Invalid payload" }, { status: 400 });
  }

  await prisma.pendingAppAccess.delete({
    where: { email_appId: { email, appId } },
  });

  return Response.json({ ok: true });
}
