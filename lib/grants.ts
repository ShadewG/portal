import { allApps, type AppConfig } from "@/lib/apps";
import { CASES_DASHBOARD_APP_ID } from "@/lib/casesAccess";

/**
 * Grant catalog (R-2159 M2). Every grant a person can hold, with a label and its parent app.
 *
 * - An app grant is the app id from lib/apps.ts (stored in AppAccess.appId exactly as today).
 * - A tab grant is "<app id>.<tab>", e.g. "pulse.hiring", stored in the same AppAccess table.
 *   Parent rule (lib/access.ts grantAllowed): a tab grant only counts when its app is usable. The owner has every tab.
 *   Exception (M4, 27 Nov 2026): tabs listed in lib/access.ts SHELL_TABS (only pulse.hiring) count on their own row.
 * - Ids not in this catalog are unknown: the check endpoint answers false and setGrants refuses them.
 *
 * `enforced` says whether the app itself already asks Portal for this grant. Tabs start false: their apps still use
 * their own gates until each one is migrated (M4 Pulse, M5 the rest). The catalog lives in code, not in the DB.
 *
 * X3 (Samuel, 28 Nov 2026): `ownerOnly` grants (full Hiring board, Servers, investor Cases dashboard) can be changed by
 * the owner only. `effect` says when a change reaches the person: "now" (the app asks Portal on every click: Pulse,
 * Desk, Render Farm, KPI), "next-sign-in" (the app keeps its own sign-in, 180 to 365 days), "tile-only" (no Portal
 * gate, the grant only shows the tile) or "none" (the toggle changes nothing today: open to everyone, decided by
 * another list, or a tab whose app does not ask Portal yet). The /access page hides "none" toggles.
 */
export type GrantEffect = "now" | "next-sign-in" | "tile-only" | "none";
export interface GrantDef {
  id: string;
  label: string;
  /** Parent app id (for an app grant: its own id). */
  app: string;
  kind: "app" | "tab";
  enforced: boolean;
  ownerOnly: boolean;
  effect: GrantEffect;
  note?: string;
  /** Shown under the label in the person's toggle list: what has to be true for the grant to do anything. */
  toggleNote?: string;
}

/** Apps that ask Portal on every request (forward_auth or Portal's own pages), so a change applies at once. */
const CHECKED_EVERY_CLICK = new Set(["pulse", "desk", "renderfarm", "kpi"]);
const OWNER_ONLY = new Set([CASES_DASHBOARD_APP_ID, "pulse.hiring", "pulse.servers"]);

function appEffect(app: AppConfig): GrantEffect {
  if (app.requiresPortalAuth === false) return "tile-only";
  if (app.signInOff) return "none";
  if (app.allowAnyAuthenticatedUser || app.id === CASES_DASHBOARD_APP_ID) return "none";
  return CHECKED_EVERY_CLICK.has(app.id) ? "now" : "next-sign-in";
}

const appGrants: GrantDef[] = allApps.map((app) => ({
  id: app.id,
  label: app.name,
  app: app.id,
  kind: "app",
  enforced: app.requiresPortalAuth !== false,
  ownerOnly: OWNER_ONLY.has(app.id),
  effect: appEffect(app),
  note: app.requiresPortalAuth === false ? "No Portal gate: the grant only shows the tile."
    : app.allowAnyAuthenticatedUser ? "Open to everyone signed in: the toggle changes nothing."
    : app.id === CASES_DASHBOARD_APP_ID ? "Decided by the owner's own list (lib/casesAccess.ts), not this toggle."
    : app.signInOff ? "Portal sign-in for this app is not switched on yet." : undefined,
}));

// Known tabs and areas (inventory/apps.md, 23 Nov 2026). Add one line per tab; the parent must be an app id above.
// Labels are plain words (B4): the page shows them under their app, so "Hiring", not "Pulse: Hiring".
const tabGrants: GrantDef[] = ([
  // R-3258 X5 B review P8: what the grant does since B5. The full board stays on allowed.json (Samuel only).
  { id: "pulse.hiring", label: "Hiring (reviewers see only their own trials)", app: "pulse", kind: "tab", enforced: false,
    note: "Full board: /opt/hiring-desk allowed.json (Samuel only). This grant opens only a named reviewer's own trials, and only while HIRING_PORTAL_GRANTS=1 is set on the hiring desk.",
    toggleNote: "Does nothing until the switch HIRING_PORTAL_GRANTS is on, and only for people the hub names as reviewers." },
  { id: "pulse.servers", label: "Servers", app: "pulse", kind: "tab", enforced: false,
    note: "Live gate today: /opt/server-pulse/gate.py hardcoded pair (Samuel)." },
  { id: "pulse.takedowns", label: "Takedowns", app: "pulse", kind: "tab", enforced: false,
    note: "Live gate today: /opt/takedown-desk allowed.json (2 users)." },
  { id: "desk.production", label: "Production", app: "desk", kind: "tab", enforced: false,
    note: "Live gate today: Case Master /internal/desk-production (anyone with a desk)." },
  { id: "foia-sorter.distribution", label: "Distribution", app: "foia-sorter", kind: "tab", enforced: false,
    note: "Live gate today: Sorter manage_users." },
  { id: "foia-sorter.patreon", label: "Patreon", app: "foia-sorter", kind: "tab", enforced: false,
    note: "Live gate today: Sorter manage_users (final) or patreon_people (reviewer)." },
  { id: "foia-sorter.podcast", label: "Podcast", app: "foia-sorter", kind: "tab", enforced: false,
    note: "Live gate today: Sorter admin or podcast team table." },
] as Omit<GrantDef, "ownerOnly" | "effect">[]).map((g) => ({
  ...g, ownerOnly: OWNER_ONLY.has(g.id), effect: g.enforced ? "now" : "none",
}));

export const grantCatalog: readonly GrantDef[] = [...appGrants, ...tabGrants];

const byId = new Map(grantCatalog.map((g) => [g.id, g]));

export function getGrant(id: string): GrantDef | undefined {
  return byId.get(id);
}

export function isKnownGrant(id: unknown): id is string {
  return typeof id === "string" && byId.has(id);
}

/** Tab grants under one app, in catalog order. */
/** What comes with the Pulse app grant and has no toggle of its own (plain tab names for the /access page). */
export const PULSE_INCLUDED_TABS = ["Production", "Stuck cases", "Patreon", "FOIA cases"] as const;

/** Full label: "Pulse: Hiring" for a tab, the app name for an app (audit log, dry run, check lists). */
export function fullLabel(g: GrantDef): string {
  return g.kind === "tab" ? `${byId.get(g.app)?.label ?? g.app}: ${g.label}` : g.label;
}

export function tabsOf(appId: string): GrantDef[] {
  return tabGrants.filter((g) => g.app === appId);
}

// Fail at build/start if a tab names a parent that is not an app, or an id is used twice.
for (const g of tabGrants) {
  if (!byId.has(g.app) || byId.get(g.app)?.kind !== "app") throw new Error(`grant catalog: ${g.id} has unknown parent ${g.app}`);
  if (!g.id.startsWith(`${g.app}.`)) throw new Error(`grant catalog: ${g.id} must start with "${g.app}."`);
}
if (byId.size !== grantCatalog.length) throw new Error("grant catalog: duplicate id");
