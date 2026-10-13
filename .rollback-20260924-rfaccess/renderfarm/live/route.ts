import { auth } from "@/auth";
import { isPortalAdmin } from "@/lib/usage";
import { actorOf, farmJson, farmRequest } from "@/lib/renderfarm";

export const dynamic = "force-dynamic";

/** GET /api/renderfarm/live — render farm state, current render, queue and history (admins only). */
export async function GET() {
  const session = await auth();
  if (!(await isPortalAdmin(session))) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  return farmJson(await farmRequest("GET", "/api/portal/live", actorOf(session)));
}
