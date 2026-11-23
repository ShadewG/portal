// No imports: scripts/check-team-access.mjs loads this file on its own (node --experimental-strip-types).
// Desk + Production for the whole team, by Discord (Samuel, 2 Nov 2026: "for sure discord sign in to desk in general",
// "everyone should get production access"). Nobody hand-grants Desk any more: someone who signs in with Discord and is
// a member of the Insanity Discord server with at least one of the team roles below gets the Desk grant (an AppAccess
// row, grantedBy AUTO_GRANT), and Production with it (Case Master's gate opens Production to everyone with a desk).
// Lose the role or leave the server and that grant is turned off at the next pass through Portal (Desk sends every
// page load through Portal after 12 h, and an open page renews its sign-in there after 11 h); the Desk gate
// (insanity-workspace /internal/desk-access) reads the grant live on every request, so access ends there and then.
//
// Only Desk, and only rows this rule made: an admin's own tick or untick in /admin (grantedBy = their Discord id)
// is never changed here, and no other app's grant is touched. Membership is read server-side with the bot token
// (GET /guilds/{guild}/members/{user}); the browser never says who is on the team.
//
// The team roles (2 Nov 2026): the job roles the existing Desk roster carries on the server. Not team roles: Dubbers
// and Captioner (freelance dubbing and caption contractors), Distribution, Friends of Insanity, Patreon, facebook,
// long-term, Active, Veteran, Raymond, REAL, Schedule, Team 1/2, region, game and booster roles, and every bot role.
// Bots never count, whatever their roles.
export const TEAM_GUILD_ID = "1275557298307203123";   // the Insanity Discord server
export const TEAM_ROLES: Readonly<Record<string, string>> = {
  "1444972225349287966": "Management",
  "1443306974514118769": "Ultra Admin",
  "1275562032086913036": "Admin",
  "1504114365660528771": "Manager",
  "1511005382208651334": "Production Lead",
  "1283183648652263455": "Editing Lead",
  "1283183704654614662": "Writing Lead",
  "1275562124621512814": "Lead",
  "1275562148537303211": "Senior",
  "1275562167269068800": "Junior",
  "1536130288504152206": "Editor",
  "1318636083919065118": "Editing Team",
  "1278069672528576606": "Writing",
  "1469250344805601414": "Detective",
  "1518949744301445170": "FOIA",
  "1318367093984333824": "3D Team",
  "1278074762710745290": "Accountant",
};
export const AUTO_GRANT = "auto:discord-team";
const SNOWFLAKE = /^\d{15,22}$/;
const UNKNOWN_MEMBER = 10007;   // Discord's error code for "not a member of this server" (10004 would be the server itself)

/** known: false — Discord could not be asked (no token, timeout, rate limit, an error): nothing is changed on that. */
export type TeamCheck = { known: true; team: boolean; name: string | null; avatar?: string | null } | { known: false };

export interface Member { roles?: unknown; nick?: string | null; user?: { bot?: boolean; global_name?: string | null; username?: string; avatar?: string | null } }

/** The rule itself (pure): a person, not a bot, with at least one team role. */
export function isTeamMember(m: Member | null | undefined): boolean {
  if (!m || m.user?.bot) return false;
  return Array.isArray(m.roles) && m.roles.some((id) => Object.prototype.hasOwnProperty.call(TEAM_ROLES, String(id)));
}

/** The name the team knows them by on the server: their server nickname, else their Discord display name. */
export function memberName(m: Member | null | undefined): string | null {
  const n = String(m?.nick || m?.user?.global_name || m?.user?.username || "").replace(/\s+/g, " ").trim();
  return n ? n.slice(0, 60) : null;
}

/** Their Discord picture as it is now (the hash; Portal's own sign-in keeps the one from their last Discord login, up to a
 *  year old). Desk stores it on their desk line and the directory, refreshed at every sign-in (2 Nov 2026). */
export function memberAvatar(m: Member | null | undefined): string | null {
  const h = String(m?.user?.avatar ?? "");
  return /^(a_)?[0-9a-f]{32}$/.test(h) ? h : null;
}

const cache = new Map<string, { at: number; result: TeamCheck }>();
const TTL_MS = 5 * 60_000;

/** Is this Discord account on the team right now? Asked of Discord with the bot token; a known answer is kept 5 minutes. */
export async function teamMember(discordId: string, fetcher: typeof fetch = fetch, now = Date.now()): Promise<TeamCheck> {
  if (!SNOWFLAKE.test(discordId)) return { known: false };           // demo / QA identities are never Discord members
  const token = process.env.DISCORD_TEAM_BOT_TOKEN;
  if (!token) return { known: false };
  const hit = cache.get(discordId);
  if (hit && now - hit.at < TTL_MS) return hit.result;
  let result: TeamCheck;
  try {
    const r = await fetcher(`https://discord.com/api/v10/guilds/${TEAM_GUILD_ID}/members/${discordId}`, {
      headers: { Authorization: `Bot ${token}` },
      cache: "no-store",
      signal: AbortSignal.timeout(6000),
    });
    if (r.status === 404) {
      const body = (await r.json().catch(() => null)) as { code?: number } | null;
      if (body?.code !== UNKNOWN_MEMBER) return { known: false };     // the server or the route is gone: decide nothing
      result = { known: true, team: false, name: null };
    } else if (!r.ok) {
      return { known: false };
    } else {
      const m = (await r.json()) as Member;
      result = { known: true, team: isTeamMember(m), name: memberName(m), avatar: memberAvatar(m) };
    }
  } catch {
    return { known: false };
  }
  cache.set(discordId, { at: now, result });
  if (cache.size > 2000) cache.delete(cache.keys().next().value as string);
  return result;
}
