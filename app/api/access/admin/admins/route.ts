import type { NextRequest } from "next/server";
import { setAccessAdmin } from "@/lib/accessChanges";
import { bodyOf, errorJson, guard, json, userIdOf } from "@/lib/accessAdmin";

export const dynamic = "force-dynamic";

/** POST { userId, on, note? }: make someone an access admin or stop. Owner only (checked again in setAccessAdmin). */
export async function POST(req: NextRequest) {
  const v = await guard("manage", req);
  if (v instanceof Response) return v;
  if (!v.isOwner) return json({ error: "only the owner may name access admins" }, 403);
  const b = await bodyOf(req);
  if (typeof b.userId !== "string" || !b.userId || typeof b.on !== "boolean") return json({ error: "userId and on are required" }, 400);
  const note = typeof b.note === "string" && b.note.trim() ? b.note.trim().slice(0, 300) : null;
  try {
    const r = await setAccessAdmin(v.actor, (await userIdOf(b.userId)) as string, b.on, note);
    return json({ ok: true, changeId: r.changeId });
  } catch (err) {
    return errorJson("admins", err);
  }
}
