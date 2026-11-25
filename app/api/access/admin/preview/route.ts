import type { NextRequest } from "next/server";
import { bodyOf, errorJson, guard, json, previewOf, userIdOf } from "@/lib/accessAdmin";

export const dynamic = "force-dynamic";

/** POST /api/access/admin/preview { userId, staged: { grantId: bool } } -> { now, after }: what the person can see now
 *  and with the unsaved toggles, by the lib/access.ts rule. Writes nothing. Read-only viewers may use it. */
export async function POST(req: NextRequest) {
  const v = await guard("read", req);
  if (v instanceof Response) return v;
  const b = await bodyOf(req);
  const staged = b.staged && typeof b.staged === "object" && !Array.isArray(b.staged) ? (b.staged as Record<string, boolean>) : {};
  if (typeof b.userId !== "string" || !b.userId) return json({ error: "userId is required" }, 400);
  try {
    return json(await previewOf((await userIdOf(b.userId)) as string, staged));
  } catch (err) {
    return errorJson("preview", err);
  }
}
