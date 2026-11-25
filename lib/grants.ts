import { allApps } from "@/lib/apps";

/**
 * Grant catalog (R-2159 M2). Every grant a person can hold, with a label and its parent app.
 *
 * - An app grant is the app id from lib/apps.ts (stored in AppAccess.appId exactly as today).
 * - A tab grant is "<app id>.<tab>", e.g. "pulse.hiring", stored in the same AppAccess table.
 *   Parent rule (lib/access.ts grantAllowed): a tab grant only counts when its app is usable. The owner has every tab.
 * - Ids not in this catalog are unknown: the check endpoint answers false and setGrants refuses them.
 *
 * `enforced` says whether the app itself already asks Portal for this grant. Tabs start false: their apps still use
 * their own gates until each one is migrated (M4 Pulse, M5 the rest). The catalog lives in code, not in the DB.
 */
export interface GrantDef {
  id: string;
  label: string;
  /** Parent app id (for an app grant: its own id). */
  app: string;
  kind: "app" | "tab";
  enforced: boolean;
  note?: string;
}

const appGrants: GrantDef[] = allApps.map((app) => ({
  id: app.id,
  label: app.name,
  app: app.id,
  kind: "app",
  enforced: app.requiresPortalAuth !== false,
  note: app.requiresPortalAuth === false ? "No Portal gate: the grant only shows the tile." : undefined,
}));

// Known tabs and areas (inventory/apps.md, 23 Nov 2026). Add one line per tab; the parent must be an app id above.
const tabGrants: GrantDef[] = [
  { id: "pulse.hiring", label: "Pulse: Hiring", app: "pulse", kind: "tab", enforced: false,
    note: "Live gate today: /opt/hiring-desk allowed.json (Samuel only)." },
  { id: "pulse.servers", label: "Pulse: Servers", app: "pulse", kind: "tab", enforced: false,
    note: "Live gate today: /opt/server-pulse/gate.py hardcoded pair (Samuel)." },
  { id: "pulse.takedowns", label: "Pulse: Takedowns", app: "pulse", kind: "tab", enforced: false,
    note: "Live gate today: /opt/takedown-desk allowed.json (2 users)." },
  { id: "desk.production", label: "Desk: Production", app: "desk", kind: "tab", enforced: false,
    note: "Live gate today: Case Master /internal/desk-production (anyone with a desk)." },
  { id: "foia-sorter.distribution", label: "Case Profiles: Distribution", app: "foia-sorter", kind: "tab", enforced: false,
    note: "Live gate today: Sorter manage_users." },
  { id: "foia-sorter.patreon", label: "Case Profiles: Patreon", app: "foia-sorter", kind: "tab", enforced: false,
    note: "Live gate today: Sorter manage_users (final) or patreon_people (reviewer)." },
  { id: "foia-sorter.podcast", label: "Case Profiles: Podcast", app: "foia-sorter", kind: "tab", enforced: false,
    note: "Live gate today: Sorter admin or podcast team table." },
];

export const grantCatalog: readonly GrantDef[] = [...appGrants, ...tabGrants];

const byId = new Map(grantCatalog.map((g) => [g.id, g]));

export function getGrant(id: string): GrantDef | undefined {
  return byId.get(id);
}

export function isKnownGrant(id: unknown): id is string {
  return typeof id === "string" && byId.has(id);
}

/** Tab grants under one app, in catalog order. */
export function tabsOf(appId: string): GrantDef[] {
  return tabGrants.filter((g) => g.app === appId);
}

// Fail at build/start if a tab names a parent that is not an app, or an id is used twice.
for (const g of tabGrants) {
  if (!byId.has(g.app) || byId.get(g.app)?.kind !== "app") throw new Error(`grant catalog: ${g.id} has unknown parent ${g.app}`);
  if (!g.id.startsWith(`${g.app}.`)) throw new Error(`grant catalog: ${g.id} must start with "${g.app}."`);
}
if (byId.size !== grantCatalog.length) throw new Error("grant catalog: duplicate id");
