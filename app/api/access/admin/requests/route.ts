import type { NextRequest } from "next/server";
import { bodyOf, errorJson, guard, json } from "@/lib/accessAdmin";
import { answerAsk, requestsFor } from "@/lib/accessRequests";

export const dynamic = "force-dynamic";

/** GET /api/access/admin/requests (X6, R-3258 B8): asks waiting (oldest first) and answers of the last 14 days.
 *  Owner, access admins, Portal admins (read only: canAnswer false everywhere). Everyone else 404. */
export async function GET(req: NextRequest) {
  const v = await guard("read", req);
  if (v instanceof Response) return v;
  try {
    return json(await requestsFor(v));
  } catch (err) {
    return errorJson("requests GET", err);
  }
}

/** POST /api/access/admin/requests { id, action: "approve" | "decline", note? }: owner or access admin.
 *  Approve applies the grant through setGrants (audited; the answer carries changeId for Undo). */
export async function POST(req: NextRequest) {
  const v = await guard("manage", req);
  if (v instanceof Response) return v;
  const b = await bodyOf(req);
  try {
    return json({ ok: true, ...(await answerAsk(v, b.id, b.action, b.note)) });
  } catch (err) {
    return errorJson("requests POST", err);
  }
}
