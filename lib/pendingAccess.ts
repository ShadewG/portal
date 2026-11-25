import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import { writeGrantChanges } from "@/lib/accessChanges";
import { isKnownGrant } from "@/lib/grants";

// Log each skip once per user per process (the routes call this on every /api/me and redirect). Keyed by user id + the
// pending row ids, so a new pre-grant logs again. Capped so it cannot grow without bound.
const logged = new Set<string>();
function logOnce(key: string, fn: () => void) {
  if (logged.has(key)) return;
  if (logged.size > 5000) logged.clear();
  logged.add(key);
  fn();
}

/**
 * Pre-grants by email (PendingAppAccess) are applied only when Discord says the email is verified (R-2159 risk 9).
 * Discord's /users/@me returns `verified` = "the email on this account has been verified"; auth.ts copies it into the
 * session as user.emailVerified at sign-in. Sessions from before that change have no flag and count as unverified,
 * so their pre-grants wait until the person signs in again. The pending row's email must equal the session email
 * (exact match, as before). Skips and applies are logged (user id, pending ids, app ids; never the email).
 * Applied grants are written through the audited writer (one change per sign-in, actor "pending-email"), with the
 * row values the old apply wrote (granted only; grantedBy/grantedAt untouched; keepMeta). Pending rows whose app id is
 * not in the grant catalog (lib/grants.ts) are skipped and stay unresolved. Skip logs: once per user per process.
 */
export async function applyPendingGrants(
  dbUser: { id: string; email: string | null },
  user: Record<string, unknown> | undefined,
): Promise<void> {
  const email = dbUser.email;
  if (!email) return;
  const all = await prisma.pendingAppAccess.findMany({
    where: { email, granted: true, resolvedAt: null },
  });
  if (all.length === 0) return;
  const pending = all.filter((row) => isKnownGrant(row.appId));
  const unknown = all.filter((row) => !isKnownGrant(row.appId));
  if (unknown.length) {
    logOnce(`unknown:${dbUser.id}:${unknown.map((row) => row.id).sort().join(",")}`, () =>
      console.warn("[pending-access] skipped: grant id not in the catalog", { userId: dbUser.id, pending: unknown.map((row) => row.id) }));
  }
  if (pending.length === 0) return;

  const sessionEmail = typeof user?.email === "string" ? user.email : null;
  const verified = user?.emailVerified === true;
  if (!verified || sessionEmail !== email) {
    logOnce(`unverified:${dbUser.id}:${pending.map((row) => row.id).sort().join(",")}`, () =>
      console.warn("[pending-access] not applied: email not verified by Discord", {
        userId: dbUser.id, verified, sameEmail: sessionEmail === email,
        pending: pending.map((row) => ({ id: row.id, appId: row.appId })),
      }));
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
        { changeId, keepMeta: true },
      );
    }
    await tx.pendingAppAccess.updateMany({
      where: { id: { in: pending.map((row) => row.id) } },
      data: { resolvedAt: new Date(), resolvedUserId: dbUser.id },
    });
  });
  console.log("[pending-access] applied", { userId: dbUser.id, pending: pending.map((row) => ({ id: row.id, appId: row.appId })) });
}
