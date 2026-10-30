import { farmJson, farmRequest } from "@/lib/renderfarm";
import { editorFor } from "@/lib/renderfarmEditorKey";

const MiB = 1_048_576;
const reply = (error: string, status: number) => Response.json({ error }, { status, headers: { "Cache-Control": "no-store" } });

async function readJson(req: Request, limit: number): Promise<Record<string, unknown> | Response> {
  if (!(req.headers.get("content-type") || "").toLowerCase().startsWith("application/json")) return reply("Expected JSON", 415);
  const size = Number(req.headers.get("content-length"));
  if (Number.isFinite(size) && size > limit) return reply("Request too large", 413);
  const reader = req.body?.getReader();
  if (!reader) return reply("Expected JSON object", 400);
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) { await reader.cancel(); return reply("Request too large", 413); }
    chunks.push(value);
  }
  const bytes = Buffer.concat(chunks.map((c) => Buffer.from(c)), total);
  try {
    const body: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    if (!body || typeof body !== "object" || Array.isArray(body)) return reply("Expected JSON object", 400);
    return body as Record<string, unknown>;
  } catch { return reply("Invalid JSON", 400); }
}

/** Only the two named farm spelling actions are exposed, under editor-key auth. */
export async function spellingRelay(req: Request, action: "check" | "approve"): Promise<Response> {
  const editor = editorFor(req.headers.get("authorization"));
  if (!editor) return reply("Unauthorized", 401);
  const limit = action === "check" ? MiB : 16_384; // The farm's approval handler has a 16 KiB limit.
  const parsed = await readJson(req, limit);
  if (parsed instanceof Response) return parsed;
  if (action === "check") {
    if (!Array.isArray(parsed.texts) || parsed.texts.length > 3000) return reply("texts must be an array of at most 3000 entries", 400);
  } else {
    if (!Array.isArray(parsed.words) || parsed.words.length < 1 || parsed.words.length > 50 ||
      parsed.words.some((word) => typeof word !== "string" || !word.trim() || word.length > 60 || /[\u0000-\u001f|]/.test(word))) return reply("words must be 1-50 words of at most 60 characters", 400);
  }
  // Never trust an extension-supplied editor name. If adding the server-owned name would
  // push a full 1 MiB request past the farm's own limit, omit it: the farm uses X-RF-Actor.
  const body = { ...parsed, editor };
  if (Buffer.byteLength(JSON.stringify(body), "utf8") > limit) delete (body as Record<string, unknown>).editor;
  if (Buffer.byteLength(JSON.stringify(body), "utf8") > limit) return reply("Request too large", 413);
  const path = action === "check" ? "/api/portal/spelling" : "/api/portal/spelling/approve";
  const result = await farmRequest("POST", path, editor, body, 240_000);
  if (result.status === 502 || result.status === 503) return reply("Render farm unavailable", result.status);
  // Farm errors are normally safe JSON. Redact the server-held token even if a farm error echoes it.
  const token = process.env.RENDER_FARM_TOKEN;
  const serialized = JSON.stringify(result.body);
  if (token && serialized?.includes(token)) {
    return farmJson({ status: result.status, body: JSON.parse(serialized.split(token).join("[redacted]")) });
  }
  return farmJson(result);
}
