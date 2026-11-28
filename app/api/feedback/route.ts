import type { NextRequest } from "next/server";
import { auth } from "@/auth";
import { createFeedback, FEEDBACK_MAX_BODY } from "@/lib/feedback";
import { nameBook, realName } from "@/lib/peopleNames";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "private, no-store" };
const feedback = createFeedback({ dir: process.env.PORTAL_FEEDBACK_DIR ?? "" });
const err = (status: number, error: string) => Response.json({ error }, { status, headers: NO_STORE });

/** Origins allowed to post: Portal itself (AUTH_URL's origin, e.g. http://127.0.0.1:3900 on the test copy). */
function sameOrigin(req: NextRequest): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return false;
  const allowed = new Set(["https://portal.insanity.team"]);
  try { if (process.env.AUTH_URL) allowed.add(new URL(process.env.AUTH_URL).origin); } catch { /* bad AUTH_URL: Portal only */ }
  return allowed.has(origin);
}

/** POST /api/feedback (X6 S5): one "This is confusing" note from a signed-in person. 204 saved; 400 bad text;
 *  401 signed out; 403 other origin; 413 too big; 415 not JSON; 429 too many; 503 not switched on or not saved. */
export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return err(403, "Not allowed");
  if (!/^application\/json\b/i.test(req.headers.get("content-type") ?? "")) return err(415, "Send JSON");
  const session = await auth();
  const u = session?.user as Record<string, unknown> | undefined;
  const discordId = typeof u?.discordId === "string" ? u.discordId : "";
  if (!discordId) return err(401, "Sign in first.");
  if (Number(req.headers.get("content-length") ?? 0) > FEEDBACK_MAX_BODY) return err(413, "Note too long.");
  const raw = await req.text().catch(() => "");
  if (raw.length > FEEDBACK_MAX_BODY) return err(413, "Note too long.");
  let body: unknown = null;
  try { body = JSON.parse(raw); } catch { /* handled below */ }
  if (!body || typeof body !== "object" || Array.isArray(body)) return err(400, "Note not readable.");
  const username = typeof u?.username === "string" ? u.username : null;
  const name = username ? realName(await nameBook(), { discordId, username }) : null;
  const r = await feedback.take({ discordId, username, name }, body as Record<string, unknown>);
  return r.status === 204 ? new Response(null, { status: 204, headers: NO_STORE }) : err(r.status, r.error ?? "Not saved.");
}
