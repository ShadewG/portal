import { auth } from "@/auth";
import { isPortalAdmin } from "@/lib/usage";
import { FARM_ACTIONS, actorOf, farmJson, farmRequest } from "@/lib/renderfarm";

export const dynamic = "force-dynamic";

/** POST /api/renderfarm/control {action} — start/pause/stop the farm or stop the current render (admins only). */
export async function POST(req: Request) {
  const session = await auth();
  if (!(await isPortalAdmin(session))) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  // JSON only: a cross-site form post can't set this content type without a CORS preflight.
  if (!(req.headers.get("content-type") || "").includes("application/json")) {
    return Response.json({ error: "Expected JSON" }, { status: 415 });
  }
  const body = (await req.json().catch(() => ({}))) as { action?: unknown };
  const action = String(body.action ?? "");
  if (!(FARM_ACTIONS as readonly string[]).includes(action)) {
    return Response.json({ error: "Unknown farm action" }, { status: 400 });
  }
  return farmJson(await farmRequest("POST", "/api/portal/control", actorOf(session), { action }));
}
