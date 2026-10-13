import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";

export async function POST(req: NextRequest) {
  const apiKey = req.headers.get("x-portal-app-key");
  if (!apiKey || apiKey !== process.env.PORTAL_APP_LINK_API_KEY) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const portalUserId = body.portalUserId as string | undefined;
  const appId = body.appId as string | undefined;
  const externalUserId = body.externalUserId as string | undefined;
  const externalUsername = body.externalUsername as string | undefined;
  const externalEmail = body.externalEmail as string | undefined;
  const linkedBy = body.linkedBy as string | undefined;

  if (!portalUserId || !appId || !externalUserId) {
    return Response.json({ error: "Missing required fields" }, { status: 400 });
  }

  await prisma.appUserLink.upsert({
    where: { userId_appId: { userId: portalUserId, appId } },
    update: {
      externalUserId,
      externalUsername: externalUsername ?? null,
      externalEmail: externalEmail ?? null,
      linkedBy: linkedBy ?? null,
    },
    create: {
      userId: portalUserId,
      appId,
      externalUserId,
      externalUsername: externalUsername ?? null,
      externalEmail: externalEmail ?? null,
      linkedBy: linkedBy ?? null,
    },
  });

  return Response.json({ ok: true });
}
