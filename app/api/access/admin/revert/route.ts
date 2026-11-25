import type { NextRequest } from "next/server";
import { revertChange } from "@/lib/accessChanges";
import { bodyOf, errorJson, guard, json } from "@/lib/accessAdmin";

export const dynamic = "force-dynamic";

/** POST /api/access/admin/revert { changeId, note? }: Undo one change (lib/accessChanges.ts revertChange). The
 *  refusal reason (already undone, changed since, ...) comes back as { error } with 409/403/400. */
export async function POST(req: NextRequest) {
  const v = await guard("manage", req);
  if (v instanceof Response) return v;
  const b = await bodyOf(req);
  if (typeof b.changeId !== "string" || !b.changeId) return json({ error: "changeId is required" }, 400);
  const note = typeof b.note === "string" && b.note.trim() ? b.note.trim().slice(0, 300) : null;
  try {
    const r = await revertChange(v.actor, b.changeId, note ?? "undo from the access page");
    return json({ ok: true, changeId: r.changeId, count: r.applied.length });
  } catch (err) {
    return errorJson("revert", err);
  }
}
