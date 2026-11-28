import { NextRequest } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { isPortalAdmin } from "@/lib/admin";
import { accessErrorStatus, deletePendingGrant, setPendingGrant } from "@/lib/accessChanges";
import { isOwner } from "@/lib/access";
import { maskEmail, publicId } from "@/lib/accessAdmin";

// Pre-grants by email. Portal admins may list them (emails masked unless owner); changes go through
// lib/accessChanges.ts (catalog check + audit): the owner and access admins only (X3, 28 Nov 2026).
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
  const owner = isOwner((session?.user as Record<string, unknown> | undefined)?.discordId);
  return Response.json(owner ? pending : pending.map((p) => ({
    ...p, email: maskEmail(p.email), grantedBy: null,
    resolvedUserId: p.resolvedUserId ? publicId({ isOwner: false }, p.resolvedUserId) : null,
  })));
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
    const result = await setPendingGrant(actorOf(session), email, appId, granted);
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
  let { email, appId } = (body ?? {}) as { email?: unknown; appId?: unknown };
  // { id } works too, so a non-owner (who sees masked emails) can remove a row
  const id = (body as { id?: unknown } | null)?.id;
  if (typeof id === "string" && id) {
    const row = await prisma.pendingAppAccess.findUnique({ where: { id } });
    if (!row) return Response.json({ error: "no such pre-grant" }, { status: 404 });
    email = row.email;
    appId = row.appId;
  }
  if (!email || typeof email !== "string" || !appId || typeof appId !== "string") {
    return Response.json({ error: "Invalid payload" }, { status: 400 });
  }

  try {
    const result = await deletePendingGrant(actorOf(session), email, appId);
    return Response.json({ ok: true, changeId: result.changeId });
  } catch (err) {
    return errorResponse("DELETE", err);
  }
}
