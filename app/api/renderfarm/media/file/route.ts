import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { auth } from "@/auth";
import { actorOf, canUseRenderFarm } from "@/lib/renderfarm";
import { alphaPreview, isAlpha, isDeliveredPath } from "@/lib/renderfarm-media";

export const dynamic = "force-dynamic";

/** GET /api/renderfarm/media/file?path=… — the cached browser copy of an alpha render, with Range support. */
export async function GET(req: Request) {
  const session = await auth();
  if (!(await canUseRenderFarm(session))) return Response.json({ error: "Forbidden" }, { status: 403 });
  const p = new URL(req.url).searchParams.get("path") || "";
  if (!isAlpha(p) || !(await isDeliveredPath(p, actorOf(session)))) return Response.json({ error: "Not a delivered render" }, { status: 404 });
  const state = await alphaPreview(p);
  if (!state.ready) return Response.json({ error: "Preview is still being prepared" }, { status: 409 });
  const size = (await stat(state.file)).size;
  const headers: Record<string, string> = { "Content-Type": "video/mp4", "Accept-Ranges": "bytes", "Cache-Control": "private, max-age=3600" };
  const m = (req.headers.get("range") || "").match(/^bytes=(\d*)-(\d*)$/);
  if (m && (m[1] || m[2])) {
    let start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]));
    let end = m[1] && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
    if (start >= size || start > end) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
    start = Math.max(0, start); end = Math.max(start, end);
    const body = Readable.toWeb(createReadStream(state.file, { start, end })) as ReadableStream;
    return new Response(body, { status: 206, headers: { ...headers, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": String(end - start + 1) } });
  }
  const body = Readable.toWeb(createReadStream(state.file)) as ReadableStream;
  return new Response(body, { headers: { ...headers, "Content-Length": String(size) } });
}
