import type { NextRequest } from "next/server";
import { errorJson, guard, json, pendingList } from "@/lib/accessAdmin";

export const dynamic = "force-dynamic";

/** GET /api/access/admin/pending: pre-grants by email with their status (applied / waiting for re-sign-in / ...). */
export async function GET(req: NextRequest) {
  const v = await guard("read", req);
  if (v instanceof Response) return v;
  try {
    return json({ pending: await pendingList(v) });
  } catch (err) {
    return errorJson("pending", err);
  }
}
