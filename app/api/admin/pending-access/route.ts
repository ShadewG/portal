import { NextRequest } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { isPortalAdmin } from "@/lib/admin";

export async function GET() {
  const session = await auth();
  if (!(await isPortalAdmin(session))) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const pending = await prisma.pendingAppAccess.findMany({
    orderBy: { createdAt: "desc" },
  });

  return Response.json(pending);
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!(await isPortalAdmin(session))) {
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
  if (!(await isPortalAdmin(session))) {
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
