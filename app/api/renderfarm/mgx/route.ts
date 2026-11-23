import { farmJson, farmRequest } from "@/lib/renderfarm";
import { editorFor } from "@/lib/renderfarmEditorKey";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const reply = (error: string, status: number) => Response.json({ error }, { status, headers: { "Cache-Control": "no-store" } });

/** Editor-key-only Add to MGX bridge. Card selection, conflicts and creation belong to the farm. */
export async function POST(req: Request): Promise<Response> {
  const editor = editorFor(req.headers.get("authorization"));
  if (!editor) return reply("Unauthorized", 401);
  if (!(req.headers.get("content-type") || "").toLowerCase().startsWith("application/json")) return reply("Expected JSON", 415);
  const length = Number(req.headers.get("content-length"));
  if (Number.isFinite(length) && length > 8192) return reply("Request too large", 413);
  let body: Record<string, unknown>;
  try {
    const raw = await req.text();
    if (Buffer.byteLength(raw, "utf8") > 8192) return reply("Request too large", 413);
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return reply("Expected JSON object", 400);
    body = parsed as Record<string, unknown>;
  } catch { return reply("Invalid JSON", 400); }
  if (Object.keys(body).some((key) => !["path", "filename", "project"].includes(key))) return reply("Unknown field", 400);
  if (typeof body.path !== "string" || body.path.length > 1024 || !body.path.startsWith("/Insanity/Video/") ||
      !/\.aep$/i.test(body.path) || body.path.includes("\\") || body.path.slice(1).split("/").some((part) => part === ".." || part === "." || !part) ||
      /[\u0000-\u001f]/.test(body.path)) return reply("Invalid Dropbox path", 400);
  const basename = body.path.slice(body.path.lastIndexOf("/") + 1);
  if (!/^[^/\\]{1,180}\.aep$/i.test(basename)) return reply("Invalid filename", 400);
  if (body.filename !== undefined && (typeof body.filename !== "string" || body.filename !== basename)) return reply("Invalid filename", 400);
  if (body.project !== undefined && (typeof body.project !== "string" || !/^IB\d{1,5}$/i.test(body.project))) return reply("Invalid project", 400);
  const result = await farmRequest("POST", "/api/portal/mgx", editor,
    { path: body.path, filename: basename, ...(body.project === undefined ? {} : { project: body.project }), editor }, 270_000);
  // Never expose the server-held farm credential, including in a malformed upstream error.
  const token = process.env.RENDER_FARM_TOKEN;
  const serialized = JSON.stringify(result.body);
  if (token && serialized?.includes(token)) return farmJson({ status: result.status, body: JSON.parse(serialized.split(token).join("[redacted]")) });
  return farmJson(result);
}
