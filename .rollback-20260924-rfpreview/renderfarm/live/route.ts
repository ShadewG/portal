import { auth } from "@/auth";
import { actorOf, canUseRenderFarm, farmJson, farmRequest } from "@/lib/renderfarm";

export const dynamic = "force-dynamic";

/** GET /api/renderfarm/live — render farm state, current render, queue and history (admins + Render Farm grant). */
export async function GET() {
  const session = await auth();
  if (!(await canUseRenderFarm(session))) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  return farmJson(await farmRequest("GET", "/api/portal/live", actorOf(session)));
}
