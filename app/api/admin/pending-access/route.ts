import { NextRequest } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { isPortalAdmin } from "@/lib/admin";
import { accessErrorStatus, deletePendingGrant, setPendingGrant } from "@/lib/accessChanges";

// Pre-grants by email. Any Portal admin, as before, for app grants; through lib/accessChanges.ts (catalog check +
// audit). Tab grants (dotted ids) need the owner or an access admin.
function actorOf(session: unknown) {
  const u = (session as { user?: Record<string, unknown> } | null)?.user;
  return { discordId: String(u?.discordId ?? ""), username: (u?.username as string) ?? null };
}
function errorResponse(where: string, err: unknown) {
  const status = accessErrorStatus(err);
  if (status === 500) console.error(`[/api/admin/pending-access ${where}] Error:`, String(err));
  return Response.json({ error: status === 500 ? "Internal error" : (err as Error).message }, { status });
}

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

  const body = await req.json().catch(() => null);
  const { email, appId, granted } = (body ?? {}) as { email?: unknown; appId?: unknown; granted?: unknown };
  if (!email || typeof email !== "string" || !appId || typeof appId !== "string" || typeof granted !== "boolean") {
    return Response.json({ error: "Invalid payload" }, { status: 400 });
  }

  try {
    const result = await setPendingGrant(actorOf(session), email, appId, granted, { allowPortalAdmin: true });
    return Response.json({ ok: true, changeId: result.changeId });
  } catch (err) {
    return errorResponse("POST", err);
  }
}

export async function DELETE(req: NextRequest) {
  const session = await auth();
  if (!(await isPortalAdmin(session))) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const { email, appId } = (body ?? {}) as { email?: unknown; appId?: unknown };
  if (!email || typeof email !== "string" || !appId || typeof appId !== "string") {
    return Response.json({ error: "Invalid payload" }, { status: 400 });
  }

  try {
    const result = await deletePendingGrant(actorOf(session), email, appId, { allowPortalAdmin: true });
    return Response.json({ ok: true, changeId: result.changeId });
  } catch (err) {
    return errorResponse("DELETE", err);
  }
}
