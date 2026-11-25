import type { NextRequest } from "next/server";
import { checkBatchShape, setGrantsMany, type BatchItem } from "@/lib/accessChanges";
import { bodyOf, dryRun, errorJson, guard, json, resolveItems } from "@/lib/accessAdmin";

export const dynamic = "force-dynamic";

/**
 * POST /api/access/admin/changes { items: [{ userId, changes: [{ grantId, granted, expect }] }], note?, dryRun? }
 * expect is required on every change (400 without it); bad shape or more than MAX_BATCH_CHANGES = 400.
 * dryRun true: what would change and what each person gains or loses seeing; writes nothing (read-only viewers too).
 * Otherwise: owner or access admin; all items in one transaction under one change id (one Undo reverts it all).
 */
export async function POST(req: NextRequest) {
  const b = await bodyOf(req);
  const v = await guard(b.dryRun === true ? "read" : "manage", req);
  if (v instanceof Response) return v;
  const items = (await resolveItems(b.items)) as BatchItem[];
  const note = typeof b.note === "string" && b.note.trim() ? b.note.trim().slice(0, 300) : null;
  try {
    // Same shape checks and size limit for the dry run and the save; every change must say what the caller saw (expect).
    checkBatchShape(items, { requireExpect: true });
    if (b.dryRun === true) return json({ people: await dryRun(v, items) });
    const result = await setGrantsMany(v.actor, items, note);
    return json({ ok: true, changeId: result.changeId, count: result.people.reduce((n, p) => n + p.applied.length, 0) });
  } catch (err) {
    return errorJson("changes", err);
  }
}
