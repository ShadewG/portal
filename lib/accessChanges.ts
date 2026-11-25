import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getGrant, isKnownGrant } from "@/lib/grants";
import { isOwner } from "@/lib/access";

/**
 * Audited access changes (R-2159 M2). Every write to a person's grants goes through here: AppAccess rows and their
 * AccessAudit rows are written in one transaction under one change id, and a change can be reverted as a whole.
 * Only the owner (ADMIN_DISCORD_ID) and named access admins (User.isAccessAdmin) may change grants; only the owner
 * may name access admins. Checked here, server-side, on every call, fail closed. No UI yet (M3).
 *
 * Exception kept from before M2 (needs Samuel's OK to tighten): the old /admin tick boxes (PATCH /api/admin and
 * /api/admin/pending-access) still let any Portal admin (User.isAdmin) change APP grants. They now come through here
 * too (catalog check + audit). Tab grants (dotted ids like pulse.hiring) always need the owner or an access admin.
 * Target guards (everyone but the owner): never the owner's grants, never your own.
 * Logs carry internal user ids only (never Discord ids, emails or what the caller typed).
 */

/** Pseudo grant id used in the audit log when someone is made (or stops being) an access admin. */
export const ACCESS_ADMIN_GRANT = "portal.access-admin";

export type GrantState = "none" | "on" | "off";
export interface Actor { discordId: string; username?: string | null }
export interface GrantChange { grantId: string; granted: boolean }
export interface ChangeResult { changeId: string | null; applied: { grantId: string; oldState: GrantState; newState: GrantState }[] }

export type AccessChangeCode = "forbidden" | "bad_request" | "not_found" | "conflict";
export class AccessChangeError extends Error {
  code: AccessChangeCode;
  constructor(code: AccessChangeCode, message: string) {
    super(message);
    this.code = code;
  }
}

type Tx = Prisma.TransactionClient;
const TX_OPTS = { isolationLevel: Prisma.TransactionIsolationLevel.Serializable } as const;

function stateOf(row: { granted: boolean } | null | undefined): GrantState {
  return !row ? "none" : row.granted ? "on" : "off";
}

type Level = "owner" | "access-admin" | "portal-admin" | null;
interface Authority { level: Level; userId: string | null }

/** Who the actor is for access changes, by Discord id only. Fails closed (level null on any error). */
async function authorityOf(actor: Actor | null | undefined): Promise<Authority> {
  try {
    const discordId = actor?.discordId;
    if (typeof discordId !== "string" || !discordId) return { level: null, userId: null };
    const row = await prisma.user.findUnique({ where: { discordId }, select: { id: true, isAdmin: true, isAccessAdmin: true } });
    const userId = row?.id ?? null;
    if (isOwner(discordId)) return { level: "owner", userId };
    if (row?.isAccessAdmin === true) return { level: "access-admin", userId };
    if (row?.isAdmin === true) return { level: "portal-admin", userId };
    return { level: null, userId };
  } catch (err) {
    console.error("[access] authority lookup failed", String(err));
    return { level: null, userId: null };
  }
}

/** Owner, or a User row with isAccessAdmin, matched by Discord id only. Fails closed. */
export async function canManageAccess(actor: Actor | null | undefined): Promise<boolean> {
  const { level } = await authorityOf(actor);
  return level === "owner" || level === "access-admin";
}

async function requireManager(actor: Actor): Promise<Authority> {
  const auth = await authorityOf(actor);
  if (auth.level !== "owner" && auth.level !== "access-admin") {
    throw new AccessChangeError("forbidden", "only the owner or an access admin may change access");
  }
  return auth;
}

/**
 * Who may write these grants. Owner and access admins: any catalog grant. A Portal admin: app grants only, and only
 * when the caller is one of the old /admin routes (allowPortalAdmin). Everyone else: refused.
 */
async function requireWriter(actor: Actor, grantIds: string[], allowPortalAdmin: boolean): Promise<Authority> {
  const auth = await authorityOf(actor);
  if (auth.level === "owner" || auth.level === "access-admin") return auth;
  if (auth.level === "portal-admin" && allowPortalAdmin) {
    if (grantIds.some((id) => getGrant(id)?.kind !== "app")) {
      throw new AccessChangeError("forbidden", "tab grants need the owner or an access admin");
    }
    return auth;
  }
  throw new AccessChangeError("forbidden", "only the owner or an access admin may change access");
}

/** Target guards: nobody but the owner may change the owner's grants or their own. */
function guardTarget(actor: Actor, auth: Authority, target: { id: string; discordId: string }) {
  if (auth.level === "owner") return;
  if (isOwner(target.discordId)) throw new AccessChangeError("forbidden", "only the owner may change the owner's access");
  if (target.discordId === actor.discordId || (auth.userId && target.id === auth.userId)) {
    throw new AccessChangeError("forbidden", "you may not change your own access");
  }
}

/** HTTP status for an AccessChangeError code (routes). */
export function accessErrorStatus(err: unknown): number {
  if (!(err instanceof AccessChangeError)) return 500;
  return { forbidden: 403, bad_request: 400, not_found: 404, conflict: 409 }[err.code];
}

/**
 * Write grant changes for one user inside a transaction and log them. Not exported to routes: callers are setGrants
 * (checked actor), revertChange (checked actor) and applyPendingGrants (system, verified-email pre-grants).
 */
export async function writeGrantChanges(
  tx: Tx,
  actor: { id: string; name?: string | null },
  userId: string,
  changes: GrantChange[],
  note: string | null,
  opts: { changeId?: string; revertOf?: string | null; grantedBy?: string; keepMeta?: boolean } = {},
): Promise<ChangeResult> {
  const changeId = opts.changeId ?? randomUUID();
  const applied: ChangeResult["applied"] = [];
  for (const c of changes) {
    const row = await tx.appAccess.findUnique({ where: { userId_appId: { userId, appId: c.grantId } } });
    const oldState = stateOf(row);
    const newState: GrantState = c.granted ? "on" : "off";
    if (oldState === newState) continue;
    // keepMeta (pre-grants by email): the row values the old pending apply wrote, exactly: only `granted` on an existing
    // row (grantedBy/grantedAt untouched, so an auto-managed Desk row stays auto-managed), no grantedBy on a new row.
    await tx.appAccess.upsert({
      where: { userId_appId: { userId, appId: c.grantId } },
      update: opts.keepMeta
        ? { granted: c.granted }
        : { granted: c.granted, grantedAt: new Date(), grantedBy: opts.grantedBy ?? actor.id },
      create: opts.keepMeta
        ? { userId, appId: c.grantId, granted: c.granted }
        : { userId, appId: c.grantId, granted: c.granted, grantedBy: opts.grantedBy ?? actor.id },
    });
    await tx.accessAudit.create({
      data: {
        changeId, actor: actor.id, actorName: actor.name ?? null, targetUserId: userId, grantId: c.grantId,
        oldState, newState, oldGrantedBy: row?.grantedBy ?? null, oldGrantedAt: row?.grantedAt ?? null,
        note, revertOf: opts.revertOf ?? null,
      },
    });
    applied.push({ grantId: c.grantId, oldState, newState });
  }
  return { changeId: applied.length ? changeId : null, applied };
}

/**
 * Change one person's grants. Unknown grant ids are refused (nothing is written). No-op changes are skipped.
 * opts.allowPortalAdmin: only for the old /admin routes (Portal admins keep app-grant rights, see the header).
 */
export async function setGrants(
  actor: Actor,
  userId: string,
  changes: GrantChange[],
  note?: string | null,
  opts: { allowPortalAdmin?: boolean } = {},
): Promise<ChangeResult> {
  if (!userId || typeof userId !== "string" || !Array.isArray(changes) || changes.length === 0) {
    throw new AccessChangeError("bad_request", "userId and changes are required");
  }
  const seen = new Set<string>();
  for (const c of changes) {
    if (!isKnownGrant(c?.grantId)) throw new AccessChangeError("bad_request", "unknown grant");
    if (typeof c.granted !== "boolean") throw new AccessChangeError("bad_request", `granted must be true or false: ${c.grantId}`);
    if (seen.has(c.grantId)) throw new AccessChangeError("bad_request", `grant listed twice: ${c.grantId}`);
    seen.add(c.grantId);
  }
  const auth = await requireWriter(actor, [...seen], opts.allowPortalAdmin === true);
  const result = await prisma.$transaction(async (tx) => {
    const target = await tx.user.findUnique({ where: { id: userId }, select: { id: true, discordId: true } });
    if (!target) throw new AccessChangeError("not_found", "no such user");
    guardTarget(actor, auth, target);
    return writeGrantChanges(tx, { id: actor.discordId, name: actor.username }, userId, changes, note ?? null);
  }, TX_OPTS);
  console.log("[access] setGrants", { actorUserId: auth.userId, level: auth.level, userId, changeId: result.changeId, n: result.applied.length });
  return result;
}

/** Audit target id for a pre-grant by email (the PendingAppAccess row; the email itself is never logged). */
const pendingTarget = (pendingId: string) => `pending:${pendingId}`;

/**
 * Create or change a pre-grant by email (PendingAppAccess), catalog-checked and audited (targetUserId pending:<row id>).
 * Same rights as setGrants: owner/access admin any grant, Portal admin (old /admin route) app grants only.
 */
export async function setPendingGrant(
  actor: Actor,
  email: string,
  grantId: string,
  granted: boolean,
  opts: { allowPortalAdmin?: boolean } = {},
): Promise<ChangeResult> {
  if (!email || typeof email !== "string" || typeof granted !== "boolean") throw new AccessChangeError("bad_request", "email, appId and granted are required");
  if (!isKnownGrant(grantId)) throw new AccessChangeError("bad_request", "unknown grant");
  const auth = await requireWriter(actor, [grantId], opts.allowPortalAdmin === true);
  const result = await prisma.$transaction(async (tx) => {
    const before = await tx.pendingAppAccess.findUnique({ where: { email_appId: { email, appId: grantId } } });
    const oldState = stateOf(before);
    const newState: GrantState = granted ? "on" : "off";
    const row = await tx.pendingAppAccess.upsert({
      where: { email_appId: { email, appId: grantId } },
      update: { granted, grantedBy: actor.discordId },
      create: { email, appId: grantId, granted, grantedBy: actor.discordId },
    });
    if (oldState === newState && before?.grantedBy === actor.discordId) return { changeId: null, applied: [] };
    const changeId = randomUUID();
    await tx.accessAudit.create({
      data: { changeId, actor: actor.discordId, actorName: actor.username ?? null, targetUserId: pendingTarget(row.id), grantId,
        oldState, newState, oldGrantedBy: before?.grantedBy ?? null, oldGrantedAt: before?.updatedAt ?? null, note: "pre-grant by email" },
    });
    return { changeId, applied: [{ grantId, oldState, newState }] };
  }, TX_OPTS);
  console.log("[access] setPendingGrant", { actorUserId: auth.userId, level: auth.level, changeId: result.changeId, n: result.applied.length });
  return result;
}

/** Delete a pre-grant by email. Audited. Unknown ids may be deleted (cleanup); tab ids need the owner or an access admin. */
export async function deletePendingGrant(
  actor: Actor,
  email: string,
  grantId: string,
  opts: { allowPortalAdmin?: boolean } = {},
): Promise<ChangeResult> {
  if (!email || typeof email !== "string" || !grantId || typeof grantId !== "string") throw new AccessChangeError("bad_request", "email and appId are required");
  const kind = getGrant(grantId)?.kind;
  // an unknown id with a dot is treated like a tab (fail closed)
  const asTab = kind === "tab" || (!kind && grantId.includes("."));
  const auth = await authorityOf(actor);
  const manager = auth.level === "owner" || auth.level === "access-admin";
  if (!manager && !(auth.level === "portal-admin" && opts.allowPortalAdmin === true)) {
    throw new AccessChangeError("forbidden", "only the owner or an access admin may change access");
  }
  if (!manager && asTab) throw new AccessChangeError("forbidden", "tab grants need the owner or an access admin");
  const result = await prisma.$transaction(async (tx) => {
    const before = await tx.pendingAppAccess.findUnique({ where: { email_appId: { email, appId: grantId } } });
    if (!before) throw new AccessChangeError("not_found", "no such pre-grant");
    await tx.pendingAppAccess.delete({ where: { id: before.id } });
    const changeId = randomUUID();
    await tx.accessAudit.create({
      data: { changeId, actor: actor.discordId, actorName: actor.username ?? null, targetUserId: pendingTarget(before.id), grantId,
        oldState: stateOf(before), newState: "none", oldGrantedBy: before.grantedBy ?? null, oldGrantedAt: before.updatedAt, note: "pre-grant by email deleted" },
    });
    return { changeId, applied: [{ grantId, oldState: stateOf(before), newState: "none" as GrantState }] };
  }, TX_OPTS);
  console.log("[access] deletePendingGrant", { actorUserId: auth.userId, level: auth.level, changeId: result.changeId });
  return result;
}

/** Make someone an access admin, or stop. Owner only. Logged like a grant (grantId portal.access-admin). */
export async function setAccessAdmin(actor: Actor, userId: string, on: boolean, note?: string | null): Promise<ChangeResult> {
  if (!isOwner(actor?.discordId)) throw new AccessChangeError("forbidden", "only the owner may name access admins");
  return prisma.$transaction(async (tx) => {
    const target = await tx.user.findUnique({ where: { id: userId }, select: { isAccessAdmin: true } });
    if (!target) throw new AccessChangeError("not_found", "no such user");
    const oldState: GrantState = target.isAccessAdmin ? "on" : "off";
    const newState: GrantState = on ? "on" : "off";
    if (oldState === newState) return { changeId: null, applied: [] };
    const changeId = randomUUID();
    await tx.user.update({ where: { id: userId }, data: { isAccessAdmin: on } });
    await tx.accessAudit.create({
      data: { changeId, actor: actor.discordId, actorName: actor.username ?? null, targetUserId: userId,
        grantId: ACCESS_ADMIN_GRANT, oldState, newState, note: note ?? null },
    });
    return { changeId, applied: [{ grantId: ACCESS_ADMIN_GRANT, oldState, newState }] };
  }, TX_OPTS);
}

/**
 * Undo one change: put every grant it touched back exactly as it was (row deleted if there was none, else the old
 * granted flag, grantedBy and grantedAt; a row the change deleted is created again). Refuses (conflict):
 *  - a change that was already reverted (any audit row has revertOf = this change),
 *  - if any grant in it changed since: a later audit row for the same person and grant (same millisecond counts as
 *    later, fail closed), or the current state is not the state the change left.
 * A revert can itself be reverted (that re-applies the original change), under the same rules.
 * Pre-grant (pending:) changes are not revertible here. Non-owners may not revert changes to the owner or to themselves.
 * Logged as a new change with revertOf = the reverted change.
 */
export async function revertChange(actor: Actor, changeId: string, note?: string | null): Promise<ChangeResult> {
  const auth = await requireManager(actor);
  if (!changeId || typeof changeId !== "string") throw new AccessChangeError("bad_request", "changeId is required");
  const result = await prisma.$transaction(async (tx) => {
    const rows = await tx.accessAudit.findMany({ where: { changeId }, orderBy: { at: "asc" } });
    if (rows.length === 0) throw new AccessChangeError("not_found", "no such change");
    if (await tx.accessAudit.findFirst({ where: { revertOf: changeId } })) throw new AccessChangeError("conflict", "already reverted");
    if (rows.some((r) => r.targetUserId.startsWith("pending:"))) throw new AccessChangeError("bad_request", "pre-grant changes cannot be reverted here");
    if (rows.some((r) => r.grantId === ACCESS_ADMIN_GRANT) && auth.level !== "owner") {
      throw new AccessChangeError("forbidden", "only the owner may revert an access admin change");
    }
    for (const targetId of new Set(rows.map((r) => r.targetUserId))) {
      const target = await tx.user.findUnique({ where: { id: targetId }, select: { id: true, discordId: true } });
      if (!target) throw new AccessChangeError("conflict", "user is gone");
      guardTarget(actor, auth, target);
    }
    for (const r of rows) {
      // later changes to this grant, oldest first; a later change that was reverted later still cancels out with its
      // revert (undo in reverse order works). Anything left over means the grant changed since: refuse.
      const later = await tx.accessAudit.findMany({
        where: { targetUserId: r.targetUserId, grantId: r.grantId, changeId: { not: changeId }, at: { gte: r.at } },
        orderBy: [{ at: "asc" }, { id: "asc" }],
        select: { changeId: true, revertOf: true },
      });
      const effective = new Set<string>();
      for (const l of later) {
        if (l.revertOf && effective.has(l.revertOf)) effective.delete(l.revertOf);
        else effective.add(l.changeId);
      }
      if (effective.size > 0) throw new AccessChangeError("conflict", `${r.grantId} changed since`);
    }
    const newChangeId = randomUUID();
    const applied: ChangeResult["applied"] = [];
    for (const r of rows) {
      let before: { grantedBy: string | null; grantedAt: Date } | null = null;
      if (r.grantId === ACCESS_ADMIN_GRANT) {
        const u = await tx.user.findUnique({ where: { id: r.targetUserId }, select: { isAccessAdmin: true } });
        if (!u) throw new AccessChangeError("conflict", "user is gone");
        const cur: GrantState = u.isAccessAdmin ? "on" : "off";
        if (cur !== r.newState) throw new AccessChangeError("conflict", `${r.grantId} changed since`);
        await tx.user.update({ where: { id: r.targetUserId }, data: { isAccessAdmin: r.oldState === "on" } });
      } else {
        const where = { userId_appId: { userId: r.targetUserId, appId: r.grantId } };
        const row = await tx.appAccess.findUnique({ where });
        const cur = stateOf(row);
        if (cur !== r.newState) throw new AccessChangeError("conflict", `${r.grantId} changed since`);
        before = row;
        if (r.oldState === "none") {
          await tx.appAccess.delete({ where });
        } else {
          // upsert: when reverting a revert, the first revert may have deleted the row (create it again as it was)
          const values = { granted: r.oldState === "on", grantedBy: r.oldGrantedBy, ...(r.oldGrantedAt ? { grantedAt: r.oldGrantedAt } : {}) };
          await tx.appAccess.upsert({ where, update: values, create: { userId: r.targetUserId, appId: r.grantId, ...values } });
        }
      }
      await tx.accessAudit.create({
        data: { changeId: newChangeId, actor: actor.discordId, actorName: actor.username ?? null, targetUserId: r.targetUserId,
          grantId: r.grantId, oldState: r.newState, newState: r.oldState as GrantState,
          oldGrantedBy: before?.grantedBy ?? null, oldGrantedAt: before?.grantedAt ?? null, note: note ?? `revert ${changeId}`, revertOf: changeId },
      });
      applied.push({ grantId: r.grantId, oldState: r.newState as GrantState, newState: r.oldState as GrantState });
    }
    return { changeId: newChangeId, applied };
  }, TX_OPTS);
  console.log("[access] revertChange", { actorUserId: auth.userId, level: auth.level, changeId, newChangeId: result.changeId, n: result.applied.length });
  return result;
}
