import type { NextRequest } from "next/server";
import { fullLabel, grantCatalog, PULSE_INCLUDED_TABS } from "@/lib/grants";
import { baselineSees, guard, json, errorJson, peopleFor, presetList } from "@/lib/accessAdmin";

export const dynamic = "force-dynamic";

/** GET /api/access/admin: everything the /access page needs to start (R-2159 M3). Owner, access admins, Portal admins. */
export async function GET(req: NextRequest) {
  const v = await guard("read", req);
  if (v instanceof Response) return v;
  try {
    return json({
      viewer: { can: v.can, isOwner: v.isOwner, name: v.actor.username },
      catalog: grantCatalog.map((g) => ({
        id: g.id, label: g.label, full: fullLabel(g), app: g.app, kind: g.kind, enforced: g.enforced,
        ownerOnly: g.ownerOnly, effect: g.effect, note: g.note ?? null,
      })),
      pulseIncluded: PULSE_INCLUDED_TABS,
      baseline: baselineSees(),
      people: await peopleFor(v),
      presets: await presetList(),
    });
  } catch (err) {
    return errorJson("GET", err);
  }
}
