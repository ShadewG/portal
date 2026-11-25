import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import { writeGrantChanges } from "@/lib/accessChanges";

/**
 * Pre-grants by email (PendingAppAccess) are applied only when Discord says the email is verified (R-2159 risk 9).
 * Discord's /users/@me returns `verified` = "the email on this account has been verified"; auth.ts copies it into the
 * session as user.emailVerified at sign-in. Sessions from before that change have no flag and count as unverified,
 * so their pre-grants wait until the person signs in again. The pending row's email must equal the session email
 * (exact match, as before). Skips and applies are logged (user id, pending ids, app ids; never the email).
 * Applied grants are written through the audited writer (one change per sign-in, actor "pending-email").
 */
export async function applyPendingGrants(
  dbUser: { id: string; email: string | null },
  user: Record<string, unknown> | undefined,
): Promise<void> {
  const email = dbUser.email;
  if (!email) return;
  const pending = await prisma.pendingAppAccess.findMany({
    where: { email, granted: true, resolvedAt: null },
  });
  if (pending.length === 0) return;

  const sessionEmail = typeof user?.email === "string" ? user.email : null;
  const verified = user?.emailVerified === true;
  if (!verified || sessionEmail !== email) {
    console.warn("[pending-access] not applied: email not verified by Discord", {
      userId: dbUser.id, verified, sameEmail: sessionEmail === email,
      pending: pending.map((row) => ({ id: row.id, appId: row.appId })),
    });
    return;
  }

  const changeId = randomUUID();
  await prisma.$transaction(async (tx) => {
    for (const row of pending) {
      await writeGrantChanges(
        tx,
        { id: "pending-email", name: row.grantedBy ? `pre-grant by ${row.grantedBy}` : "pre-grant" },
        dbUser.id,
        [{ grantId: row.appId, granted: true }],
        `pre-grant ${row.id} (verified email)`,
        { changeId, grantedBy: row.grantedBy ?? "pending-email" },
      );
    }
    await tx.pendingAppAccess.updateMany({
      where: { id: { in: pending.map((row) => row.id) } },
      data: { resolvedAt: new Date(), resolvedUserId: dbUser.id },
    });
  });
  console.log("[pending-access] applied", { userId: dbUser.id, pending: pending.map((row) => ({ id: row.id, appId: row.appId })) });
}
