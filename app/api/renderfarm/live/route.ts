import { auth } from "@/auth";
import { actorOf, farmJson, farmRequest, renderFarmAccess, type FarmResponse } from "@/lib/renderfarm";
import { rememberDelivered } from "@/lib/renderfarm-media";

export const dynamic = "force-dynamic";

// Every open page polls every 5 s and the farm PC is also the render machine, so one farm read
// (and any read still in flight) serves every viewer for a few seconds.
const SHARE_MS = 3000;
let shared: { until: number; r: Promise<FarmResponse> } | null = null;
function farmLive(actor: string): Promise<FarmResponse> {
  if (shared && Date.now() < shared.until) return shared.r;
  const entry = { until: Infinity, r: farmRequest("GET", "/api/portal/live", actor) };
  shared = entry;
  void entry.r.then(() => { entry.until = Date.now() + SHARE_MS; });
  return entry.r;
}

/**
 * GET /api/renderfarm/live — render farm state, current render, queue and history (the team: lib/renderfarmAccess.ts).
 * `viewer.canControl` says whether this person gets the farm controls.
 */
export async function GET() {
  const session = await auth();
  const access = await renderFarmAccess(session);
  if (!access.view) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  const r = await farmLive(actorOf(session));
  if (r.status !== 200 || !r.body || typeof r.body !== "object") return farmJson(r);
  rememberDelivered((r.body as { history?: { type: string; detail: string }[] }).history);
  return farmJson({ status: 200, body: { ...(r.body as Record<string, unknown>), viewer: { canControl: access.control } } });
}
