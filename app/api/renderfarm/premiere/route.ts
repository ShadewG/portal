import { auth } from "@/auth";
import { actorOf, renderFarmAccess } from "@/lib/renderfarm";

export const dynamic = "force-dynamic";

/**
 * Premiere renders on the render PC (owner, 16 Nov 2026: "make UI adjust for being able to queue premiere renders").
 * The queue itself lives in the premiere-farm service on this server (/home/claude/premiere-farm, 127.0.0.1:8791):
 * it plans each project, downloads its files to the PC in queue order while After Effects renders, renders one at a
 * time after After Effects, compares with the editor's final, uploads and adds a Video Review link.
 *
 * GET  ?op=jobs                      the queue (team: same people who see the Render Farm)
 * GET  ?op=search&q=IB57             Premiere projects in Dropbox by name
 * POST {op:'add', projects, preset, position, no_captions}      admins + Render Farm grant (no_captions: captions off in the farm copy)
 * POST {op:'reorder', order:[job...]}
 * POST {op:'action', job, action, value}
 */
const BASE = process.env.PREMIERE_FARM_URL || "http://127.0.0.1:8791";

async function pf(method: "GET" | "POST", path: string, who: { id: string; name: string }, body?: unknown): Promise<Response> {
  const token = process.env.PREMIERE_FARM_TOKEN || "";
  if (!token) return Response.json({ error: "The portal is not configured with PREMIERE_FARM_TOKEN" }, { status: 503 });
  try {
    const res = await fetch(BASE + path, {
      method,
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
      headers: {
        Authorization: `Bearer ${token}`,
        "X-PF-User-Id": who.id,
        "X-PF-User-Name": encodeURIComponent(who.name),
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({ error: `Premiere queue answered HTTP ${res.status} without JSON` }));
    return Response.json(data, { status: res.status, headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return Response.json({ error: `Premiere queue unreachable: ${e instanceof Error ? e.message : String(e)}` }, { status: 502 });
  }
}

function whoOf(session: unknown): { id: string; name: string } {
  const user = ((session as { user?: Record<string, unknown> } | null)?.user ?? {}) as Record<string, unknown>;
  return { id: String(user.discordId || ""), name: actorOf(session) };
}

export async function GET(req: Request) {
  const session = await auth();
  const access = await renderFarmAccess(session);
  if (!access.view) return Response.json({ error: "Forbidden" }, { status: 403 });
  const url = new URL(req.url);
  const op = url.searchParams.get("op") || "jobs";
  if (op === "search") {
    if (!access.control) return Response.json({ error: "Forbidden" }, { status: 403 });
    const q = (url.searchParams.get("q") || "").slice(0, 120);
    return pf("GET", `/search?q=${encodeURIComponent(q)}`, whoOf(session));
  }
  if (op !== "jobs") return Response.json({ error: "Unknown op" }, { status: 400 });
  const res = await pf("GET", "/jobs", whoOf(session));
  if (!res.ok) return res;
  const data = (await res.json()) as Record<string, unknown>;
  return Response.json({ ...data, viewer: { canControl: access.control } }, { headers: { "Cache-Control": "no-store" } });
}

const ACTIONS = ["hold", "resume", "approve", "retry", "remove", "top", "bottom", "preset", "sequence"];

export async function POST(req: Request) {
  const session = await auth();
  if (!(await renderFarmAccess(session)).control) return Response.json({ error: "Forbidden" }, { status: 403 });
  // JSON only: a cross-site form post can't set this content type without a CORS preflight.
  if (!(req.headers.get("content-type") || "").includes("application/json")) return Response.json({ error: "Expected JSON" }, { status: 415 });
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const who = whoOf(session);
  switch (body.op) {
    case "add": {
      const projects = (Array.isArray(body.projects) ? body.projects : []).map(String).filter((p) => p.startsWith("/") && /\.prproj$/i.test(p)).slice(0, 200);
      if (!projects.length) return Response.json({ error: "Pick at least one Premiere project" }, { status: 400 });
      return pf("POST", "/jobs", who, { projects, preset: String(body.preset || "insanity"), position: body.position === "top" ? "top" : "bottom", no_captions: body.no_captions === true });
    }
    case "reorder": {
      const order = (Array.isArray(body.order) ? body.order : []).map(String).filter((j) => /^[A-Za-z0-9_-]{1,40}$/.test(j)).slice(0, 1000);
      return pf("POST", "/reorder", who, { order });
    }
    case "action": {
      const job = String(body.job || "");
      const action = String(body.action || "");
      if (!/^[A-Za-z0-9_-]{1,40}$/.test(job) || !ACTIONS.includes(action)) return Response.json({ error: "Unknown job or action" }, { status: 400 });
      return pf("POST", `/jobs/${job}`, who, { action, value: body.value === undefined ? undefined : String(body.value) });
    }
    default:
      return Response.json({ error: "Unknown op" }, { status: 400 });
  }
}
