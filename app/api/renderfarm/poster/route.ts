import { readFile } from "node:fs/promises";
import { auth } from "@/auth";
import { actorOf, canUseRenderFarm } from "@/lib/renderfarm";
import { isDeliveredPath, posterFile } from "@/lib/renderfarm-media";

export const dynamic = "force-dynamic";

/** GET /api/renderfarm/poster?path=<Dropbox path of a delivered render> — a JPEG thumbnail. */
export async function GET(req: Request) {
  const session = await auth();
  if (!(await canUseRenderFarm(session))) return Response.json({ error: "Forbidden" }, { status: 403 });
  const p = new URL(req.url).searchParams.get("path") || "";
  if (!(await isDeliveredPath(p, actorOf(session)))) return Response.json({ error: "Not a delivered render" }, { status: 404 });
  try {
    const body = await readFile(await posterFile(p));
    return new Response(body, { headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=86400" } });
  } catch (e) {
    const status = (e as { status?: number }).status || 502;
    return Response.json({ error: String((e as Error).message || e).slice(0, 200) }, { status });
  }
}
