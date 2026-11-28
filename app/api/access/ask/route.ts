import type { NextRequest } from "next/server";
import { auth } from "@/auth";
import { bodyOf, errorJson, json, refuseCrossSite } from "@/lib/accessAdmin";
import { createAsk } from "@/lib/accessRequests";

export const dynamic = "force-dynamic";

/**
 * POST /api/access/ask { grantId, reason? } (X6, R-3258 B8): the signed-in person asks for one grant. Same CSRF rule
 * as every /api/access write (Portal origin + JSON). Answers { state: "open", at, already? } or { state: "has" }.
 * One open ask per person and grant; at most 10 open and 10 a day per person. Not signed in: 401.
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  const discordId = (session?.user as { discordId?: unknown } | undefined)?.discordId;
  if (typeof discordId !== "string" || !discordId) return json({ error: "Sign in first." }, 401);
  const refused = refuseCrossSite(req);
  if (refused) return refused;
  const b = await bodyOf(req);
  try {
    return json(await createAsk(discordId, b.grantId, b.reason));
  } catch (err) {
    return errorJson("ask", err);
  }
}
