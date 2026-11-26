import { auth } from "@/auth";
import { actorOf, farmJson, farmRequest, renderFarmAccess } from "@/lib/renderfarm";
import { productionConfigured, productionMgx } from "@/lib/productionFarm";

export const dynamic = "force-dynamic";

type MgxResult = { id?: string; ok?: boolean; kind?: string; queued?: boolean; skipped?: string; error?: string };
const reply = (body: Record<string, unknown>, status: number) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

/**
 * POST /api/renderfarm/requeue {pageId, kind} — put a Failed card back in the render queue (admins + Render Farm grant only).
 * Not "your own failed renders" for everyone (15 Oct 2026): the farm's rows do not say who queued a card.
 *
 * 23 Nov 2026 (Samuel, relayed by the hub): goes through Production (op "render" on the MGX row, for the person who pressed
 * the button), so Production records "<name> (via Render Farm)" and writes Notion with its own rules. The card's pageId is
 * the MGX table row the farm reads. The farm PC's own requeue is used only when Production can't be used at all (no key,
 * wrong key, unreachable) or the card is not an MGX row Production knows; a person Production refuses stays refused.
 */
export async function POST(req: Request) {
  const session = await auth();
  if (!(await renderFarmAccess(session)).control) {
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
  const viaFarm = async (why: string) => {
    const r = await farmRequest("POST", "/api/portal/requeue", actorOf(session), { pageId, kind });
    const b = (r.body && typeof r.body === "object" ? r.body : {}) as Record<string, unknown>;
    if (r.status < 300 && typeof b.message === "string") b.message = `${b.message} (${why}; queued on the farm directly)`;
    return farmJson({ status: r.status, body: b });
  };
  if (!productionConfigured()) return viaFarm("Production key missing");

  const user = ((session as { user?: Record<string, unknown> } | null)?.user ?? {}) as Record<string, unknown>;
  const discordId = String(user.discordId ?? "");
  if (!/^\d{15,25}$/.test(discordId)) {
    return reply({ error: "Your sign-in has no Discord account, which Production needs to record who re-queued it." }, 403);
  }
  const r = await productionMgx(discordId, { op: "render", ids: [pageId], kind });
  const b = (r.body && typeof r.body === "object" ? r.body : {}) as { results?: MgxResult[]; notes?: string[]; message?: string; error?: string };
  // Production itself can't be used (no/wrong key, down): the farm's own requeue keeps the button working
  if (r.status === 401 || r.status >= 500) {
    console.error("renderfarm requeue: Production answered", r.status, "- using the farm's own requeue");
    return viaFarm(r.status === 401 ? "Production refused Portal's key" : "Production unreachable");
  }
  if (r.status === 400 && b.error === "Unknown MGX item.") return viaFarm("not an MGX item in Production");
  if (r.status !== 200) return reply({ error: b.error || `Production answered HTTP ${r.status}` }, r.status);

  const results = Array.isArray(b.results) ? b.results : [];
  const mine = results.find((x) => x.kind === kind) ?? results.find((x) => !x.ok) ?? results[0];
  if (!mine) return reply({ error: b.message || "Production changed nothing" }, 502);
  if (!mine.ok && mine.error === "That MGX item is gone.") return viaFarm("not an MGX item in Production");
  if (!mine.ok) return reply({ error: mine.error || "Production did not re-queue it" }, 409);
  if (mine.skipped) return reply({ error: `Not re-queued: ${mine.skipped}` }, 409);
  const notes = (b.notes || []).filter(Boolean).join(" ");
  return reply({ message: `Back in the queue through Production (${b.message || "render queued"})${notes ? `. ${notes}` : ""}` }, 200);
}
