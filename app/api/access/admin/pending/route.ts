import { errorJson, guard, json, pendingList } from "@/lib/accessAdmin";

export const dynamic = "force-dynamic";

/** GET /api/access/admin/pending: pre-grants by email with their status (applied / waiting for re-sign-in / ...). */
export async function GET() {
  const v = await guard("read");
  if (v instanceof Response) return v;
  try {
    return json({ pending: await pendingList() });
  } catch (err) {
    return errorJson("pending", err);
  }
}
