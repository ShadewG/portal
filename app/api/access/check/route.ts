import type { NextRequest } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { grantAllowed, grantedIds, isOwner } from "@/lib/access";
import { isKnownGrant } from "@/lib/grants";
import { syncTeamDesk } from "@/lib/teamAccess";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "private, no-store" };

/**
 * GET /api/access/check?grant=<id> -> { allowed: boolean } for the signed-in person (R-2159 M2).
 * Same rule as /api/me (lib/access.ts grantAllowed). Never creates or updates the user.
 * desk and desk.*: first the same Desk team sync /api/auth/redirect?app=desk runs (lib/teamAccess.ts syncTeamDesk, full
 * check, not grantOnly), so the answer is never older than the redirect's. Only for a user row that already exists.
 * Fails closed: signed out 401, unknown or missing grant 200 false, any error 503 false. Clients cache for 60 s at most.
 */
export async function GET(req: NextRequest) {
  try {
    const grant = req.nextUrl.searchParams.get("grant") ?? "";
    const session = await auth();
    const user = session?.user as Record<string, unknown> | undefined;
    const discordId = typeof user?.discordId === "string" ? user.discordId : "";
    if (!discordId) return Response.json({ allowed: false }, { status: 401, headers: NO_STORE });
    if (!isKnownGrant(grant)) return Response.json({ allowed: false }, { headers: NO_STORE });

    const dbUser = await prisma.user.findUnique({ where: { discordId }, select: { id: true, isAdmin: true } });
    if (dbUser && (grant === "desk" || grant.startsWith("desk."))) await syncTeamDesk({ id: dbUser.id, discordId });
    const allowed = grantAllowed(grant, {
      discordId,
      user,
      isAdmin: Boolean(dbUser?.isAdmin) || isOwner(discordId),
      granted: await grantedIds(dbUser?.id ?? ""),
    });
    return Response.json({ allowed: allowed === true }, { headers: NO_STORE });
  } catch (err) {
    console.error("[/api/access/check] Error:", String(err));
    return Response.json({ allowed: false }, { status: 503, headers: NO_STORE });
  }
}
