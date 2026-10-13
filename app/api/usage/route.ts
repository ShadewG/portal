import { auth } from "@/auth";
import { isPortalAdmin, readUsage } from "@/lib/usage";

export const dynamic = "force-dynamic";

/** GET /api/usage — live plan usage of the Codex + Claude accounts (admins only). */
export async function GET() {
  const session = await auth();
  if (!(await isPortalAdmin(session))) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  const data = await readUsage();
  return Response.json(data, { headers: { "Cache-Control": "no-store" } });
}
