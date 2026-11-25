import type { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { grantAllowed, grantedIds, isOwner } from "@/lib/access";
import { isKnownGrant } from "@/lib/grants";
import { SERVICE_KEY_HEADER, serviceKeyConfigured, serviceKeyOk } from "@/lib/serviceKey";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "private, no-store" };
const DISCORD_ID = /^\d{15,22}$/;
const MAX_BATCH = 16;

/**
 * Server-to-server access check (R-2159 M4). No cookie: the caller is an app backend, authenticated by the shared
 * secret in the X-Portal-Access-Key header (lib/serviceKey.ts, constant-time compare).
 *
 *   GET  /api/access/check/server?grant=<id>&discordId=<id>          -> { allowed: boolean }
 *   POST /api/access/check/server  {"discordId": "...", "grants": ["pulse.hiring", ...]}  (max 16)
 *                                                                    -> { allowed: { "<grant>": boolean, ... } }
 *
 * Same rule as the cookie form and /api/me (lib/access.ts grantAllowed). Read only: no user is created or updated,
 * and unlike the cookie form it does not run the Desk team sync first (desk answers reflect the last sync).
 * Never returns user data, only booleans. Fails closed:
 *   secret not configured on Portal 503 false; missing or wrong key 401 false; bad discordId, unknown user or unknown
 *   grant 200 false; any error 503 false. Clients cache 60 s and send one batch per person to stay cheap.
 */
async function answers(discordId: string, grants: string[]): Promise<Record<string, boolean>> {
  const out: Record<string, boolean> = Object.fromEntries(grants.map((g) => [g, false]));
  if (!DISCORD_ID.test(discordId)) return out;
  const known = grants.filter(isKnownGrant);
  if (known.length === 0) return out;
  const dbUser = await prisma.user.findUnique({ where: { discordId }, select: { id: true, isAdmin: true } });
  if (!dbUser) return out;
  const ctx = {
    discordId,
    user: { discordId },
    isAdmin: Boolean(dbUser.isAdmin) || isOwner(discordId),
    granted: await grantedIds(dbUser.id),
  };
  for (const g of known) out[g] = grantAllowed(g, ctx) === true;
  return out;
}

function refuse(req: NextRequest): Response | null {
  if (!serviceKeyConfigured()) return Response.json({ allowed: false }, { status: 503, headers: NO_STORE });
  if (!serviceKeyOk(req.headers.get(SERVICE_KEY_HEADER))) return Response.json({ allowed: false }, { status: 401, headers: NO_STORE });
  return null;
}

export async function GET(req: NextRequest) {
  try {
    const no = refuse(req);
    if (no) return no;
    const grant = req.nextUrl.searchParams.get("grant") ?? "";
    const discordId = req.nextUrl.searchParams.get("discordId") ?? "";
    const allowed = (await answers(discordId, [grant]))[grant] === true;
    return Response.json({ allowed }, { headers: NO_STORE });
  } catch (err) {
    console.error("[/api/access/check/server] Error:", (err as { name?: string })?.name ?? "error");
    return Response.json({ allowed: false }, { status: 503, headers: NO_STORE });
  }
}

export async function POST(req: NextRequest) {
  try {
    const no = refuse(req);
    if (no) return no;
    const raw = await req.text();
    if (raw.length > 4096) return Response.json({ allowed: {} }, { status: 413, headers: NO_STORE });
    let body: unknown;
    try { body = JSON.parse(raw); } catch { return Response.json({ allowed: {} }, { status: 400, headers: NO_STORE }); }
    const b = body as { discordId?: unknown; grants?: unknown };
    const grants = Array.isArray(b?.grants) ? b.grants : null;
    if (!grants || grants.length === 0 || grants.length > MAX_BATCH || !grants.every((g) => typeof g === "string" && g.length <= 64)) {
      return Response.json({ allowed: {} }, { status: 400, headers: NO_STORE });
    }
    const discordId = typeof b.discordId === "string" ? b.discordId : "";
    return Response.json({ allowed: await answers(discordId, [...new Set(grants as string[])]) }, { headers: NO_STORE });
  } catch (err) {
    console.error("[/api/access/check/server] Error:", (err as { name?: string })?.name ?? "error");
    return Response.json({ allowed: {} }, { status: 503, headers: NO_STORE });
  }
}
