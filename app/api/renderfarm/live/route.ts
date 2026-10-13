import { auth } from "@/auth";
import { actorOf, canUseRenderFarm, farmJson, farmRequest } from "@/lib/renderfarm";
import { rememberDelivered } from "@/lib/renderfarm-media";

export const dynamic = "force-dynamic";

/** GET /api/renderfarm/live — render farm state, current render, queue and history (admins + Render Farm grant). */
export async function GET() {
  const session = await auth();
  if (!(await canUseRenderFarm(session))) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  const r = await farmRequest("GET", "/api/portal/live", actorOf(session));
  if (r.status === 200) rememberDelivered((r.body as { history?: { type: string; detail: string }[] }).history);
  return farmJson(r);
}
