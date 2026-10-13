import { prisma } from "@/lib/db";
import { allApps } from "@/lib/apps";
import { FRONTWIND_DUBBING_APP_ID, isFrontwindDubbingAllowed } from "@/lib/frontwindAccess";
import { CASES_DASHBOARD_APP_ID, isCasesDashboardAllowed } from "@/lib/casesAccess";

/** The app ids this user may open — the same rules /api/me answers with, as a list.
 *  Desk receives it in its handoff token so it can show each person only their own tools. */
export async function permittedAppIds(
  dbUser: { id: string; isAdmin: boolean },
  user: Record<string, unknown> | undefined,
): Promise<string[]> {
  const discordId = String(user?.discordId ?? "");
  const rows = await prisma.appAccess.findMany({ where: { userId: dbUser.id, granted: true } });
  const granted = new Set(rows.map((r) => r.appId));
  return allApps
    .filter((app) => {
      const hasAppAccess = granted.has(app.id);
      const gate = (app as { allowedDiscordId?: string }).allowedDiscordId;
      if (gate) return discordId === gate && hasAppAccess;
      if (app.id === CASES_DASHBOARD_APP_ID) return isCasesDashboardAllowed(user);
      if (app.id === FRONTWIND_DUBBING_APP_ID) return hasAppAccess && isFrontwindDubbingAllowed(user);
      if (app.requireExplicitGrant) return hasAppAccess;
      return Boolean(app.allowAnyAuthenticatedUser) || dbUser.isAdmin || hasAppAccess;
    })
    .map((app) => app.id);
}
