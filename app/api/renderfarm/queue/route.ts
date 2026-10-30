import { farmJson, farmRequest } from "@/lib/renderfarm";
import { editorFor } from "@/lib/renderfarmEditorKey";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 450;

const allowed = new Set(["project", "filename", "path", "contentHash", "skipCheck", "pageId", "kind", "waitSeconds", "format", "comps"]);
const json = (error: string, status: number) => Response.json({ error }, { status, headers: { "Cache-Control": "no-store" } });

/** Editor-key-only bridge; no Portal cookie, farm control or generic proxy access. */
export async function POST(req: Request) {
  const editor = editorFor(req.headers.get("authorization"));
  if (!editor) return json("Unauthorized", 401);
  if (!(req.headers.get("content-type") || "").toLowerCase().startsWith("application/json")) return json("Expected JSON", 415);
  const raw = await req.text();
  if (raw.length > 8192) return json("Request too large", 413);
  let body: Record<string, unknown>;
  try {
    const value: unknown = JSON.parse(raw);
    if (value === null || typeof value !== "object" || Array.isArray(value)) return json("Expected JSON object", 400);
    body = value as Record<string, unknown>;
  } catch { return json("Invalid JSON", 400); }
  if (Object.keys(body).some((key) => !allowed.has(key))) return json("Unknown field", 400);
  if (typeof body.project !== "string" || !/^IB\d{1,5}$/i.test(body.project)) return json("Invalid project", 400);
  if (typeof body.filename !== "string" || !/^[^/\\]{1,180}\.aep$/i.test(body.filename)) return json("Invalid filename", 400);
  if (typeof body.path !== "string" || body.path.length > 1024 || !body.path.startsWith("/Insanity/Video/") || !body.path.endsWith("/" + body.filename) || body.path.includes("..")) return json("Invalid Dropbox path", 400);
  if (typeof body.contentHash !== "string" || !/^[0-9a-f]{64}$/i.test(body.contentHash)) return json("Invalid Dropbox content hash", 400);
  if (body.skipCheck !== undefined && typeof body.skipCheck !== "boolean") return json("Invalid skipCheck", 400);
  if (body.pageId !== undefined && (typeof body.pageId !== "string" || !/^[0-9a-f-]{32,36}$/i.test(body.pageId))) return json("Invalid pageId", 400);
  if (body.kind !== undefined && body.kind !== "texted" && body.kind !== "textless") return json("Invalid kind", 400);
  if (body.waitSeconds !== undefined && (typeof body.waitSeconds !== "number" || !Number.isInteger(body.waitSeconds) || body.waitSeconds < 0 || body.waitSeconds > 600)) return json("Invalid waitSeconds", 400);
  if (body.format !== undefined && (typeof body.format !== "string" || !/^(Default|HQ|Alpha)$/i.test(body.format))) return json("Invalid format", 400);
  if (body.comps !== undefined && body.comps !== "all" && (!Array.isArray(body.comps) || body.comps.length < 1 || body.comps.length > 32 || body.comps.some((comp) => {
    const validName = (name: unknown) => typeof name === "string" && name.trim().length > 0 && name.length <= 200 && !/[\u0000-\u001f]/.test(name);
    if (validName(comp)) return false;
    if (typeof comp === "number") return !Number.isInteger(comp) || comp <= 0 || comp > 999;
    if (comp === null || typeof comp !== "object" || Array.isArray(comp)) return true;
    const entry = comp as Record<string, unknown>;
    return !validName(entry.name) || typeof entry.format !== "string" || !/^(Default|HQ|Alpha)$/i.test(entry.format) ||
      Object.keys(entry).some((key) => key !== "name" && key !== "format");
  }))) return json("Invalid comps", 400);
  // The farm owns syncing, card selection, queue state and response semantics.
  return farmJson(await farmRequest("POST", "/api/portal/queue", `AE editor: ${editor}`, body, 430_000));
}
