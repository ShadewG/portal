export const RENDER_FARM_APP_ID = "renderfarm";

/**
 * Who sees the Render Farm (owner, 15 Oct 2026: "everyone ... so they can see their renders").
 *
 * Seeing it (queue, live status, history, previews, Review/Share links) is for the team: Portal
 * admins, and anyone Portal has approved for one of the team's everyday tools below, or for Render
 * Farm itself. Portal has no "team member" flag, so an approval for one of these tools is what marks
 * one. Not counted: people with nothing approved yet, guests approved only for a pilot (Patreon), and
 * the ProjectA outreacher account (Autobot only).
 *
 * Controlling it (start, pause or stop the farm, stop the current render, re-queue a failed card)
 * stays with admins plus the explicit `renderfarm` grant: see renderFarmAccess in lib/renderfarm.ts.
 */
export const RENDER_FARM_TEAM_APP_IDS: readonly string[] = ["foia-sorter", "desk", "pulse", "script-reviewer"];

/** True when someone with these granted app ids may see the Render Farm. */
export function isRenderFarmViewer(isAdmin: boolean, grantedAppIds: Iterable<string>): boolean {
  if (isAdmin) return true;
  for (const id of grantedAppIds) {
    if (id === RENDER_FARM_APP_ID || RENDER_FARM_TEAM_APP_IDS.includes(id)) return true;
  }
  return false;
}
