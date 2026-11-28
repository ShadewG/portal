import { auth } from "@/auth";
import { viewerOf } from "@/lib/accessAdmin";

export const dynamic = "force-dynamic";

/** GET /api/access/me: may the signed-in person open /access, and change things there?
 *  { can: "manage" | "read" | null, isOwner }. Used by Home (the Access link) and the old /admin page (read only). */
export async function GET() {
  const v = await viewerOf(await auth());
  return Response.json({ can: v?.can ?? null, isOwner: v?.isOwner ?? false }, { headers: { "Cache-Control": "private, no-store" } });
}
