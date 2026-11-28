import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { viewerOf } from "@/lib/accessAdmin";
import { grantedIds, isOwner, shellTabTiles } from "@/lib/access";
import { myAsks, offeredFor, waitingFor } from "@/lib/accessRequests";

export const dynamic = "force-dynamic";

/** GET /api/access/me: may the signed-in person open /access, and change things there?
 *  { can: "manage" | "read" | null, isOwner, waiting, asks, tiles }. Used by Home (the Access link, "Your asks", the
 *  one-tab tiles) and the old /admin page (read only). X6: waiting = asks this person can answer; asks = their own asks
 *  of the last 30 days; tiles = tab grants they open without the app (today pulse.hiring alone: the "Hiring" tile); offer = app ids
 *  they may ask for (no old tools, no owner-decided ones for plain members).
 *  Kept out of /api/me on purpose, so /api/me answers stay exactly as before (mirror). */
export async function GET() {
  const session = await auth();
  const v = await viewerOf(session);
  const discordId = (session?.user as { discordId?: unknown } | undefined)?.discordId;
  let asks: Awaited<ReturnType<typeof myAsks>> = [];
  let tiles: string[] = [];
  let offer: string[] = [];
  if (typeof discordId === "string" && discordId) {
    asks = await myAsks(discordId).catch(() => []);
    offer = await offeredFor(discordId).catch(() => []);
    const u = await prisma.user.findUnique({ where: { discordId }, select: { id: true, isAdmin: true } }).catch(() => null);
    if (u) {
      tiles = shellTabTiles({ discordId, user: { discordId }, isAdmin: u.isAdmin || isOwner(discordId), granted: await grantedIds(u.id) });
    }
  }
  const waiting = v ? await waitingFor(v).catch(() => 0) : 0;
  return Response.json(
    { can: v?.can ?? null, isOwner: v?.isOwner ?? false, waiting, asks, tiles, offer },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
