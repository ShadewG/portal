// No imports: tools/test_users.mjs loads this file on its own (node --experimental-strip-types).
/**
 * B0 test members (hub decision 28 Nov 2026): three Portal users made by us to test as real roles on production.
 * A test user is marked twice: username starts with "TEST " AND discordId starts with "test:". Real Discord ids are
 * digits only, so a test id can never match a real account, and lib/teamRule.ts never asks Discord about it (no
 * Desk team sync, no server check). Sessions are minted by tools/test_users.mjs with a testUntil claim (max 24 h);
 * auth.ts refuses a test session after that time, even if the cookie was refreshed.
 * Counts: tools/m2_mirror.mjs lists them apart; anything that counts real people should skip isTestUser().
 */
export const TEST_ID_PREFIX = "test:";
export const TEST_NAME_PREFIX = "TEST ";
export const TEST_MAX_HOURS = 24;

export function isTestUser(u: { username?: unknown; discordId?: unknown } | null | undefined): boolean {
  return typeof u?.username === "string" && u.username.startsWith(TEST_NAME_PREFIX)
    && typeof u?.discordId === "string" && u.discordId.startsWith(TEST_ID_PREFIX);
}

/** A test Discord id ("test:..."). Sign-in routes never create a User row for one (review S7): a test session whose row
 *  was removed is refused instead of bringing the user back. */
export function isTestDiscordId(discordId: unknown): boolean {
  return typeof discordId === "string" && discordId.startsWith(TEST_ID_PREFIX);
}

/** True when this session claim set belongs to a test user whose time is up (or has no end time). */
export function testSessionExpired(token: Record<string, unknown>, now = Date.now()): boolean {
  if (typeof token.discordId !== "string" || !token.discordId.startsWith(TEST_ID_PREFIX)) return false;
  const until = Number(token.testUntil);
  return !Number.isFinite(until) || now > until * 1000 || until * 1000 - now > TEST_MAX_HOURS * 3600_000 + 60_000;
}
