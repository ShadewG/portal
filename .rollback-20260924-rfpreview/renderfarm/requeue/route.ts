import { auth } from "@/auth";
import { actorOf, canUseRenderFarm, farmJson, farmRequest } from "@/lib/renderfarm";

export const dynamic = "force-dynamic";

/** POST /api/renderfarm/requeue {pageId, kind} — put a Failed card back in the render queue (admins + Render Farm grant). */
export async function POST(req: Request) {
  const session = await auth();
  if (!(await canUseRenderFarm(session))) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!(req.headers.get("content-type") || "").includes("application/json")) {
    return Response.json({ error: "Expected JSON" }, { status: 415 });
  }
  const body = (await req.json().catch(() => ({}))) as { pageId?: unknown; kind?: unknown };
  const pageId = String(body.pageId ?? "");
  const kind = body.kind === "textless" ? "textless" : "texted";
  if (!/^[0-9a-f-]{32,36}$/i.test(pageId)) {
    return Response.json({ error: "Invalid Notion page id" }, { status: 400 });
  }
  return farmJson(await farmRequest("POST", "/api/portal/requeue", actorOf(session), { pageId, kind }));
}
