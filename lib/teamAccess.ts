import { prisma } from "@/lib/db";
import { AUTO_GRANT, teamMember, type TeamCheck } from "@/lib/teamRule";

// The Desk grant, kept in line with the team rule (lib/teamRule.ts says who is on the team and why).
export { AUTO_GRANT, type TeamCheck };
const DESK = "desk";

/** Bring this person's Desk grant in line with the team rule. grantOnly (Portal's /api/me, which runs on every page's
 *  bar): only someone with no Desk row yet is looked up, so a newcomer sees Desk in the bar without visiting it first.
 *  Returns what Discord said (for the "this is for the team" page and the display name). Never throws. */
export async function syncTeamDesk(user: { id: string; discordId: string }, opts: { grantOnly?: boolean } = {}): Promise<TeamCheck> {
  try {
    const row = await prisma.appAccess.findUnique({ where: { userId_appId: { userId: user.id, appId: DESK } } });
    if (opts.grantOnly && row) return { known: false };
    const check = await teamMember(user.discordId);
    if (!check.known) return check;
    // an admin's own decision stands; only a row this rule made (or no row) is managed here
    if (row && row.grantedBy !== AUTO_GRANT) return check;
    if (check.team && !row) {
      await prisma.appAccess.create({ data: { userId: user.id, appId: DESK, granted: true, grantedBy: AUTO_GRANT } }).catch((err: unknown) => {
        if ((err as { code?: string })?.code !== "P2002") throw err;    // a second tab made it a moment ago
      });
      console.log("[team-access] desk granted", { discordId: user.discordId });
    } else if (row && check.team !== row.granted) {
      // updateMany scoped to the row and to the rule's own marker: an admin edit in between is never overwritten
      await prisma.appAccess.updateMany({ where: { id: row.id, grantedBy: AUTO_GRANT }, data: { granted: check.team, grantedAt: new Date() } });
      console.log(`[team-access] desk ${check.team ? "granted again" : "turned off (no team role on Discord)"}`, { discordId: user.discordId });
    }
    return check;
  } catch (err) {
    console.error("[team-access] sync failed", { discordId: user.discordId, error: String(err) });
    return { known: false };
  }
}
