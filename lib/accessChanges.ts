import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { isKnownGrant } from "@/lib/grants";
import { isOwner } from "@/lib/access";

/**
 * Audited access changes (R-2159 M2). Every write to a person's grants goes through here: AppAccess rows and their
 * AccessAudit rows are written in one transaction under one change id, and a change can be reverted as a whole.
 * Only the owner (ADMIN_DISCORD_ID) and named access admins (User.isAccessAdmin) may change grants; only the owner
 * may name access admins. Checked here, server-side, on every call, fail closed. No UI yet (M3).
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

/** Owner, or a User row with isAccessAdmin, matched by Discord id only. Fails closed. */
export async function canManageAccess(actor: Actor | null | undefined): Promise<boolean> {
  try {
    const discordId = actor?.discordId;
    if (typeof discordId !== "string" || !discordId) return false;
    if (isOwner(discordId)) return true;
    const row = await prisma.user.findUnique({ where: { discordId }, select: { isAccessAdmin: true } });
    return row?.isAccessAdmin === true;
  } catch (err) {
    console.error("[access] canManageAccess failed", String(err));
    return false;
  }
}

async function requireManager(actor: Actor) {
  if (!(await canManageAccess(actor))) throw new AccessChangeError("forbidden", "only the owner or an access admin may change access");
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
  opts: { changeId?: string; revertOf?: string | null; grantedBy?: string } = {},
): Promise<ChangeResult> {
  const changeId = opts.changeId ?? randomUUID();
  const applied: ChangeResult["applied"] = [];
  for (const c of changes) {
    const row = await tx.appAccess.findUnique({ where: { userId_appId: { userId, appId: c.grantId } } });
    const oldState = stateOf(row);
    const newState: GrantState = c.granted ? "on" : "off";
    if (oldState === newState) continue;
    await tx.appAccess.upsert({
      where: { userId_appId: { userId, appId: c.grantId } },
      update: { granted: c.granted, grantedAt: new Date(), grantedBy: opts.grantedBy ?? actor.id },
      create: { userId, appId: c.grantId, granted: c.granted, grantedBy: opts.grantedBy ?? actor.id },
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

/** Change one person's grants. Unknown grant ids are refused (nothing is written). No-op changes are skipped. */
export async function setGrants(actor: Actor, userId: string, changes: GrantChange[], note?: string | null): Promise<ChangeResult> {
  await requireManager(actor);
  if (!userId || !Array.isArray(changes) || changes.length === 0) throw new AccessChangeError("bad_request", "userId and changes are required");
  const seen = new Set<string>();
  for (const c of changes) {
    if (!isKnownGrant(c?.grantId)) throw new AccessChangeError("bad_request", `unknown grant: ${String(c?.grantId)}`);
    if (typeof c.granted !== "boolean") throw new AccessChangeError("bad_request", `granted must be true or false: ${c.grantId}`);
    if (seen.has(c.grantId)) throw new AccessChangeError("bad_request", `grant listed twice: ${c.grantId}`);
    seen.add(c.grantId);
  }
  const result = await prisma.$transaction(async (tx) => {
    const target = await tx.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!target) throw new AccessChangeError("not_found", "no such user");
    return writeGrantChanges(tx, { id: actor.discordId, name: actor.username }, userId, changes, note ?? null);
  }, TX_OPTS);
  console.log("[access] setGrants", { actor: actor.discordId, userId, changeId: result.changeId, n: result.applied.length });
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
 * granted flag, grantedBy and grantedAt). Refuses if a grant was changed again since (conflict), if the change was
 * already reverted, or if the change is itself a revert of something already undone. Logged as a new change.
 */
export async function revertChange(actor: Actor, changeId: string, note?: string | null): Promise<ChangeResult> {
  await requireManager(actor);
  if (!changeId) throw new AccessChangeError("bad_request", "changeId is required");
  const result = await prisma.$transaction(async (tx) => {
    const rows = await tx.accessAudit.findMany({ where: { changeId }, orderBy: { at: "asc" } });
    if (rows.length === 0) throw new AccessChangeError("not_found", "no such change");
    if (await tx.accessAudit.findFirst({ where: { revertOf: changeId } })) throw new AccessChangeError("conflict", "already reverted");
    if (rows.some((r) => r.grantId === ACCESS_ADMIN_GRANT) && !isOwner(actor.discordId)) {
      throw new AccessChangeError("forbidden", "only the owner may revert an access admin change");
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
        const row = await tx.appAccess.findUnique({ where: { userId_appId: { userId: r.targetUserId, appId: r.grantId } } });
        const cur = stateOf(row);
        if (cur !== r.newState) throw new AccessChangeError("conflict", `${r.grantId} changed since`);
        before = row;
        if (r.oldState === "none") {
          await tx.appAccess.delete({ where: { userId_appId: { userId: r.targetUserId, appId: r.grantId } } });
        } else {
          await tx.appAccess.update({
            where: { userId_appId: { userId: r.targetUserId, appId: r.grantId } },
            data: { granted: r.oldState === "on", grantedBy: r.oldGrantedBy, ...(r.oldGrantedAt ? { grantedAt: r.oldGrantedAt } : {}) },
          });
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
  console.log("[access] revertChange", { actor: actor.discordId, changeId, newChangeId: result.changeId, n: result.applied.length });
  return result;
}
