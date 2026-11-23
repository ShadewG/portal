import { prisma } from "@/lib/db";

/**
 * Portal admin check. Matches the signed-in Discord id only (never email or username):
 * the env owner (ADMIN_DISCORD_ID) or a User row with isAdmin. Fails closed.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function isPortalAdmin(session: any): Promise<boolean> {
  const discordId = (session?.user as Record<string, unknown> | undefined)?.discordId;
  if (typeof discordId !== "string" || !discordId) return false;
  if (discordId === process.env.ADMIN_DISCORD_ID) return true;
  const dbUser = await prisma.user.findUnique({ where: { discordId }, select: { isAdmin: true } });
  return dbUser?.isAdmin === true;
}
