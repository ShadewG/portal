import type { NextRequest } from "next/server";
import { setGrantsMany, type BatchItem } from "@/lib/accessChanges";
import { bodyOf, dryRun, errorJson, guard, json } from "@/lib/accessAdmin";

export const dynamic = "force-dynamic";

/**
 * POST /api/access/admin/changes { items: [{ userId, changes: [{ grantId, granted, expect }] }], note?, dryRun? }
 * dryRun true: what would change and what each person gains or loses seeing; writes nothing (read-only viewers too).
 * Otherwise: owner or access admin; all items in one transaction under one change id (one Undo reverts it all).
 */
export async function POST(req: NextRequest) {
  const b = await bodyOf(req);
  const v = await guard(b.dryRun === true ? "read" : "manage");
  if (v instanceof Response) return v;
  if (!Array.isArray(b.items) || b.items.length === 0) return json({ error: "no changes" }, 400);
  const items = b.items as BatchItem[];
  const note = typeof b.note === "string" && b.note.trim() ? b.note.trim().slice(0, 300) : null;
  try {
    if (b.dryRun === true) return json({ people: await dryRun(items) });
    const result = await setGrantsMany(v.actor, items, note);
    return json({ ok: true, changeId: result.changeId, count: result.people.reduce((n, p) => n + p.applied.length, 0) });
  } catch (err) {
    return errorJson("changes", err);
  }
}
