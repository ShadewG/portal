import { auth } from "@/auth";
import { actorOf, renderFarmAccess } from "@/lib/renderfarm";
import { alphaPreview, isAlpha, isDeliveredPath, temporaryLink } from "@/lib/renderfarm-media";

export const dynamic = "force-dynamic";

/**
 * GET /api/renderfarm/media?path=<Dropbox path of a delivered render> — where to play it.
 * H.264 renders play straight from a Dropbox temporary link; alpha (ProRes) renders play from a
 * cached browser copy, which is made on first request ({ready:false} until it exists).
 */
export async function GET(req: Request) {
  const session = await auth();
  if (!(await renderFarmAccess(session)).view) return Response.json({ error: "Forbidden" }, { status: 403 });
  const p = new URL(req.url).searchParams.get("path") || "";
  if (!(await isDeliveredPath(p, actorOf(session)))) return Response.json({ error: "Not a delivered render" }, { status: 404 });
  try {
    if (!isAlpha(p)) return Response.json({ ready: true, url: await temporaryLink(p), alpha: false }, { headers: { "Cache-Control": "no-store" } });
    const state = await alphaPreview(p);
    if (state.error) console.error("render farm media: alpha copy failed:", String(state.error).slice(0, 500));
    return Response.json(
      { ready: state.ready, alpha: true, error: state.error ? "This render can't play right now" : undefined, url: state.ready ? `/api/renderfarm/media/file?path=${encodeURIComponent(p)}` : null },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    const status = (e as { status?: number }).status || 502;
    // the error can hold a server path: logged on the server only, the browser gets a fixed line
    console.error("render farm media failed:", String((e as Error).message || e).slice(0, 500));
    return Response.json({ error: "This render can't play right now" }, { status });
  }
}
