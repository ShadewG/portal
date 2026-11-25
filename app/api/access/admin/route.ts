import { grantCatalog } from "@/lib/grants";
import { baselineSees, guard, json, errorJson, peopleFor, presetList } from "@/lib/accessAdmin";

export const dynamic = "force-dynamic";

/** GET /api/access/admin: everything the /access page needs to start (R-2159 M3). Owner, access admins, Portal admins. */
export async function GET() {
  const v = await guard("read");
  if (v instanceof Response) return v;
  try {
    return json({
      viewer: { can: v.can, isOwner: v.isOwner, name: v.actor.username },
      catalog: grantCatalog.map(({ id, label, app, kind, enforced, note }) => ({ id, label, app, kind, enforced, note: note ?? null })),
      baseline: baselineSees(),
      people: await peopleFor(v),
      presets: await presetList(),
    });
  } catch (err) {
    return errorJson("GET", err);
  }
}
