import type { NextRequest } from "next/server";
import { bodyOf, createPreset, errorJson, guard, json, presetList } from "@/lib/accessAdmin";

export const dynamic = "force-dynamic";

/** GET: list presets. POST { name, description?, grantIds }: create (owner or access admin). Presets never change anyone. */
export async function GET(req: NextRequest) {
  const v = await guard("read", req);
  if (v instanceof Response) return v;
  try {
    return json({ presets: await presetList() });
  } catch (err) {
    return errorJson("presets GET", err);
  }
}

export async function POST(req: NextRequest) {
  const v = await guard("manage", req);
  if (v instanceof Response) return v;
  try {
    const p = await createPreset(v, await bodyOf(req));
    return json({ ok: true, id: p.id });
  } catch (err) {
    return errorJson("presets POST", err);
  }
}
