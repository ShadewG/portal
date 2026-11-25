import type { NextRequest } from "next/server";
import { auditList, errorJson, guard, json, userIdOf } from "@/lib/accessAdmin";

export const dynamic = "force-dynamic";

/** GET /api/access/admin/audit?person=<user id>&actor=<user id>&page=<n>: changes newest first, grouped by change. */
export async function GET(req: NextRequest) {
  const v = await guard("read", req);
  if (v instanceof Response) return v;
  const q = req.nextUrl.searchParams;
  try {
    return json(await auditList(v, {
      person: ((await userIdOf(q.get("person"))) as string | null) || undefined,
      actor: ((await userIdOf(q.get("actor"))) as string | null) || undefined,
      page: Number(q.get("page") ?? 0) || 0,
    }));
  } catch (err) {
    return errorJson("audit", err);
  }
}
