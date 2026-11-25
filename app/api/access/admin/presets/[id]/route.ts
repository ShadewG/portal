import type { NextRequest } from "next/server";
import { bodyOf, deletePreset, errorJson, guard, json, updatePreset } from "@/lib/accessAdmin";

export const dynamic = "force-dynamic";

/** PATCH { name, description?, grantIds } / DELETE one preset. Owner or access admin. Never changes anyone's access. */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const v = await guard("manage");
  if (v instanceof Response) return v;
  try {
    await updatePreset((await ctx.params).id, await bodyOf(req));
    return json({ ok: true });
  } catch (err) {
    return errorJson("presets PATCH", err);
  }
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const v = await guard("manage");
  if (v instanceof Response) return v;
  try {
    await deletePreset((await ctx.params).id);
    return json({ ok: true });
  } catch (err) {
    return errorJson("presets DELETE", err);
  }
}
