import { prisma } from "@/lib/db";
import { allApps, getAppById, type AppConfig } from "@/lib/apps";
import { getGrant } from "@/lib/grants";
import { FRONTWIND_DUBBING_APP_ID, isFrontwindDubbingAllowed } from "@/lib/frontwindAccess";
import { CASES_DASHBOARD_APP_ID, isCasesDashboardAllowed } from "@/lib/casesAccess";
import { RENDER_FARM_APP_ID, isRenderFarmViewer } from "@/lib/renderfarmAccess";

/**
 * The one access rule (R-2159 M2). /api/me, /api/apps, /api/auth/redirect and /api/access/check all decide here,
 * so they can never disagree. The app rules are exactly the ones that were repeated by hand in those routes before
 * M2 (proof: tools/m2_mirror.mjs, 0 changes over every user in portal_dev).
 */
export interface AccessContext {
  /** Signed-in Discord id. */
  discordId: string;
  /** Session user (the cases and frontwind lists read user.discordId). */
  user: Record<string, unknown> | undefined;
  /** Portal admin: User.isAdmin (the env owner is always admin). */
  isAdmin: boolean;
  /** AppAccess ids with granted = true (app ids and tab ids). */
  granted: ReadonlySet<string>;
}

/** The owner (ADMIN_DISCORD_ID). Has every tab grant. */
export function isOwner(discordId: unknown): boolean {
  const owner = process.env.ADMIN_DISCORD_ID;
  return typeof discordId === "string" && !!discordId && !!owner && discordId === owner;
}

/** May this person open this app? First match wins; same order as before M2. */
export function appAllowed(app: AppConfig, ctx: AccessContext): boolean {
  const hasAppAccess = ctx.granted.has(app.id);
  if (app.allowedDiscordId) return ctx.discordId === app.allowedDiscordId && hasAppAccess;
  if (app.id === CASES_DASHBOARD_APP_ID) return isCasesDashboardAllowed(ctx.user);
  if (app.id === FRONTWIND_DUBBING_APP_ID) return hasAppAccess && isFrontwindDubbingAllowed(ctx.user);
  if (app.id === RENDER_FARM_APP_ID) return isRenderFarmViewer(ctx.isAdmin, ctx.granted);
  if (app.requireExplicitGrant) return hasAppAccess;
  return Boolean(app.allowAnyAuthenticatedUser) || ctx.isAdmin || hasAppAccess;
}

/** The per-app map /api/me returns (every registry app, registry order). */
export function accessMap(ctx: AccessContext): Record<string, boolean> {
  const access: Record<string, boolean> = {};
  for (const app of allApps) access[app.id] = appAllowed(app, ctx);
  return access;
}

/**
 * Any catalog grant. App grant = the app rule above (so it always equals /api/me).
 * Tab grant = owner, or (a granted row for the tab AND the parent app is usable). Unknown id = false.
 */
export function grantAllowed(grantId: string, ctx: AccessContext): boolean {
  const grant = getGrant(grantId);
  if (!grant) return false;
  if (grant.kind === "app") {
    const app = getAppById(grant.id);
    return app ? appAllowed(app, ctx) : false;
  }
  if (isOwner(ctx.discordId)) return true;
  return ctx.granted.has(grant.id) && grantAllowed(grant.app, ctx);
}

/** Granted AppAccess ids for one Portal user. */
export async function grantedIds(userId: string): Promise<Set<string>> {
  if (!userId) return new Set();
  const rows = await prisma.appAccess.findMany({ where: { userId, granted: true }, select: { appId: true } });
  return new Set(rows.map((r) => r.appId));
}

/** The app ids this user may open — the same rules /api/me answers with, as a list.
 *  Desk receives it in its handoff token so it can show each person only their own tools. */
export async function permittedAppIds(
  dbUser: { id: string; isAdmin: boolean },
  user: Record<string, unknown> | undefined,
): Promise<string[]> {
  const ctx: AccessContext = {
    discordId: String(user?.discordId ?? ""),
    user,
    isAdmin: dbUser.isAdmin,
    granted: await grantedIds(dbUser.id),
  };
  return allApps.filter((app) => appAllowed(app, ctx)).map((app) => app.id);
}
