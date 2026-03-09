import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { allApps } from "@/lib/apps";

/** GET /api/me — return current user's access map */
export async function GET() {
  const session = await auth();
  const discordId = (session?.user as Record<string, unknown> | undefined)?.discordId as string | undefined;

  if (!discordId) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { discordId },
    include: { access: true },
  });

  const isAdmin = user?.isAdmin ?? discordId === process.env.ADMIN_DISCORD_ID;

  const access: Record<string, boolean> = {};
  for (const app of allApps) {
    if (isAdmin) {
      access[app.id] = true;
    } else {
      access[app.id] = user?.access.some((a) => a.appId === app.id && a.granted) ?? false;
    }
  }

  return Response.json({ discordId, isAdmin, access });
}
