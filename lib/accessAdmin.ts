import { prisma } from "@/lib/db";
import { auth } from "@/auth";
import { grantAllowed, isOwner, type AccessContext } from "@/lib/access";
import { grantCatalog, getGrant, isKnownGrant } from "@/lib/grants";
import {
  ACCESS_ADMIN_GRANT, AccessChangeError, accessErrorStatus, accessLevelOf, targetRefusal,
  type Actor, type Level,
} from "@/lib/accessChanges";

/**
 * Server side of the /access dashboard (R-2159 M3). Every /api/access/admin/* route starts with viewer(): who is asking
 * and what they may do. Owner + access admins: "manage" (change things). Other Portal admins: "read" (see only; they
 * keep the old /admin page). Everyone else: null (the routes answer 404, the page is notFound()).
 * What a person can see is always computed with lib/access.ts grantAllowed (never a second copy of the rule).
 * Names only in what we return: never Discord ids as text (avatar URLs carry them, as everywhere in Portal).
 */

export type ViewerCan = "manage" | "read";
export interface Viewer { actor: Actor; level: Level; can: ViewerCan; isOwner: boolean }

export async function viewerOf(session: unknown): Promise<Viewer | null> {
  const u = (session as { user?: Record<string, unknown> } | null)?.user;
  const discordId = typeof u?.discordId === "string" ? u.discordId : "";
  if (!discordId) return null;
  const actor: Actor = { discordId, username: typeof u?.username === "string" ? u.username : null };
  const level = await accessLevelOf(actor);
  if (level === "owner" || level === "access-admin") return { actor, level, can: "manage", isOwner: level === "owner" };
  if (level === "portal-admin") return { actor, level, can: "read", isOwner: false };
  return null;
}

const NO_STORE = { "Cache-Control": "private, no-store" };
export const json = (body: unknown, status = 200) => Response.json(body, { status, headers: NO_STORE });
export const notFound = () => json({ error: "Not found" }, 404);

/** Route guard: 404 for anyone who may not see the dashboard, 403 for read-only viewers on writes. */
export async function guard(need: ViewerCan): Promise<Viewer | Response> {
  const v = await viewerOf(await auth());
  if (!v) return notFound();
  if (need === "manage" && v.can !== "manage") return json({ error: "You can look but not change access." }, 403);
  return v;
}

/** Error to response: AccessChangeError keeps its plain message; anything else is a generic 500 (logged, no input). */
export function errorJson(where: string, err: unknown) {
  const status = accessErrorStatus(err);
  if (status === 500) console.error(`[/api/access/admin ${where}] Error:`, String(err));
  return json({ error: status === 500 ? "Something went wrong. Nothing was saved." : (err as Error).message }, status);
}

export async function bodyOf(req: Request): Promise<Record<string, unknown>> {
  const b = await req.json().catch(() => null);
  return b && typeof b === "object" && !Array.isArray(b) ? (b as Record<string, unknown>) : {};
}

export function avatarUrl(discordId: string, avatar: string | null): string | null {
  return avatar ? `https://cdn.discordapp.com/avatars/${discordId}/${avatar}.png?size=64` : null;
}

// ---------- what a person can see (lib/access.ts rule) ----------

interface PersonRow { id: string; discordId: string; isAdmin: boolean }

function ctxOf(p: PersonRow, granted: ReadonlySet<string>): AccessContext {
  return { discordId: p.discordId, user: { discordId: p.discordId }, isAdmin: p.isAdmin || isOwner(p.discordId), granted };
}

/** Catalog grant ids this person can open with these granted rows. */
export function seesWith(p: PersonRow, granted: ReadonlySet<string>): string[] {
  const ctx = ctxOf(p, granted);
  return grantCatalog.filter((g) => grantAllowed(g.id, ctx)).map((g) => g.id);
}

/** What every signed-in person gets with no grants at all (used for the "no access" filter). */
export function baselineSees(): string[] {
  return seesWith({ id: "", discordId: "", isAdmin: false }, new Set());
}

function applyStaged(granted: Set<string>, staged: Record<string, boolean>) {
  for (const [id, on] of Object.entries(staged)) {
    if (on) granted.add(id);
    else granted.delete(id);
  }
}

/** Preview for one person: what they can see now, and with these staged (unsaved) toggles. */
export async function previewOf(userId: string, staged: Record<string, boolean>) {
  const user = await prisma.user.findUnique({ where: { id: userId }, include: { access: true } });
  if (!user) throw new AccessChangeError("not_found", "no such user");
  for (const [id, on] of Object.entries(staged)) {
    if (!isKnownGrant(id) || typeof on !== "boolean") throw new AccessChangeError("bad_request", "unknown grant");
  }
  const granted = new Set(user.access.filter((a) => a.granted).map((a) => a.appId));
  const now = seesWith(user, granted);
  applyStaged(granted, staged);
  const after = seesWith(user, granted);
  return { now, after };
}

export interface StagedItem { userId: string; changes: { grantId: string; granted: boolean; expect?: boolean }[] }

/** Dry run of a batch: per person, the stored changes (old -> new) and what they gain or lose seeing. Writes nothing. */
export async function dryRun(items: StagedItem[]) {
  const ids = items.map((i) => i.userId);
  const users = await prisma.user.findMany({ where: { id: { in: ids } }, include: { access: true } });
  const byId = new Map(users.map((u) => [u.id, u]));
  return items.map((item) => {
    const u = byId.get(item.userId);
    if (!u) throw new AccessChangeError("not_found", "no such user");
    const rows = new Map(u.access.map((a) => [a.appId, a.granted]));
    const granted = new Set(u.access.filter((a) => a.granted).map((a) => a.appId));
    const before = new Set(seesWith(u, granted));
    const staged: Record<string, boolean> = {};
    const changes = item.changes.map((c) => {
      if (!isKnownGrant(c.grantId)) throw new AccessChangeError("bad_request", "unknown grant");
      staged[c.grantId] = c.granted;
      return { grantId: c.grantId, from: rows.get(c.grantId) === true, to: c.granted, stale: c.expect !== undefined && (rows.get(c.grantId) === true) !== c.expect };
    });
    applyStaged(granted, staged);
    const after = new Set(seesWith(u, granted));
    return {
      userId: u.id, username: u.username, changes,
      gains: [...after].filter((g) => !before.has(g)),
      loses: [...before].filter((g) => !after.has(g)),
    };
  });
}

// ---------- the people list ----------

export async function peopleFor(viewer: Viewer) {
  const users = await prisma.user.findMany({ include: { access: true }, orderBy: { username: "asc" } });
  return users.map((u) => {
    const rows: Record<string, { on: boolean; auto: boolean }> = {};
    for (const a of u.access) {
      if (isKnownGrant(a.appId)) rows[a.appId] = { on: a.granted, auto: (a.grantedBy ?? "").startsWith("auto:") };
    }
    const granted = new Set(u.access.filter((a) => a.granted).map((a) => a.appId));
    const lockedReason = viewer.can !== "manage"
      ? "read only"
      : targetRefusal(viewer.actor, viewer.level, u);
    return {
      id: u.id,
      username: u.username,
      avatarUrl: avatarUrl(u.discordId, u.avatar),
      isOwner: isOwner(u.discordId),
      isAdmin: u.isAdmin || isOwner(u.discordId),
      isAccessAdmin: u.isAccessAdmin,
      isYou: u.discordId === viewer.actor.discordId,
      rows,
      sees: seesWith(u, granted),
      lockedReason,
    };
  });
}

// ---------- pre-grants by email ----------

export async function pendingList() {
  const rows = await prisma.pendingAppAccess.findMany({ orderBy: { createdAt: "desc" } });
  const emails = [...new Set(rows.map((r) => r.email))];
  const users = emails.length ? await prisma.user.findMany({ where: { email: { in: emails } }, select: { id: true, email: true, username: true } }) : [];
  const byEmail = new Map(users.map((u) => [u.email, u]));
  const resolvedIds = rows.map((r) => r.resolvedUserId).filter((x): x is string => !!x);
  const resolved = resolvedIds.length ? await prisma.user.findMany({ where: { id: { in: resolvedIds } }, select: { id: true, username: true } }) : [];
  const nameOfId = new Map(resolved.map((u) => [u.id, u.username]));
  const names = await namesForDiscordIds(rows.map((r) => r.grantedBy ?? ""));
  return rows.map((r) => {
    const user = byEmail.get(r.email);
    let status: string;
    if (r.resolvedAt) status = "applied";
    else if (!isKnownGrant(r.appId)) status = "unknown grant, will not apply";
    else if (!r.granted) status = "set to off, nothing to apply";
    else if (user) status = "waiting for re-sign-in";
    else status = "waiting for first sign-in";
    return {
      id: r.id, email: r.email, grantId: r.appId, grantLabel: getGrant(r.appId)?.label ?? r.appId, granted: r.granted,
      status, createdAt: r.createdAt, resolvedAt: r.resolvedAt,
      person: r.resolvedUserId ? nameOfId.get(r.resolvedUserId) ?? null : user?.username ?? null,
      by: r.grantedBy ? names.get(r.grantedBy) ?? "someone" : null,
    };
  });
}

// ---------- audit log ----------

async function namesForDiscordIds(ids: string[]): Promise<Map<string, string>> {
  const clean = [...new Set(ids.filter(Boolean))];
  if (!clean.length) return new Map();
  const rows = await prisma.user.findMany({ where: { discordId: { in: clean } }, select: { discordId: true, username: true } });
  return new Map(rows.map((r) => [r.discordId, r.username]));
}

export function grantLabel(id: string): string {
  if (id === ACCESS_ADMIN_GRANT) return "Access admin";
  return getGrant(id)?.label ?? id;
}

/** Changes newest first, grouped by change id. Filters: person (Portal user id), actor (Portal user id). */
export async function auditList(opts: { person?: string; actor?: string; page?: number; pageSize?: number }) {
  const pageSize = Math.min(Math.max(opts.pageSize ?? 25, 1), 100);
  const page = Math.max(opts.page ?? 0, 0);
  const where: { targetUserId?: string; actor?: string } = {};
  if (opts.person) where.targetUserId = opts.person;
  if (opts.actor) {
    const a = await prisma.user.findUnique({ where: { id: opts.actor }, select: { discordId: true } });
    if (!a) return { changes: [], more: false };
    where.actor = a.discordId;
  }
  const groups = await prisma.accessAudit.groupBy({
    by: ["changeId"], where, _max: { at: true },
    orderBy: { _max: { at: "desc" } }, skip: page * pageSize, take: pageSize + 1,
  });
  const more = groups.length > pageSize;
  const changeIds = groups.slice(0, pageSize).map((g) => g.changeId);
  if (!changeIds.length) return { changes: [], more: false };
  const rows = await prisma.accessAudit.findMany({ where: { changeId: { in: changeIds } }, orderBy: [{ at: "asc" }, { id: "asc" }] });
  const reverts = await prisma.accessAudit.findMany({ where: { revertOf: { in: changeIds } }, select: { revertOf: true, at: true, actor: true, actorName: true } });
  const revertedOf = await prisma.accessAudit.findMany({
    where: { changeId: { in: [...new Set(rows.map((r) => r.revertOf).filter((x): x is string => !!x))] } },
    select: { changeId: true, at: true },
  });

  const userIds = [...new Set(rows.map((r) => r.targetUserId).filter((t) => !t.startsWith("pending:")))];
  const users = userIds.length ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, username: true } }) : [];
  const userName = new Map(users.map((u) => [u.id, u.username]));
  const pendingIds = rows.map((r) => r.targetUserId).filter((t) => t.startsWith("pending:")).map((t) => t.slice(8));
  const pend = pendingIds.length ? await prisma.pendingAppAccess.findMany({ where: { id: { in: pendingIds } }, select: { id: true, email: true } }) : [];
  const pendEmail = new Map(pend.map((p) => [p.id, p.email]));
  const actorNames = await namesForDiscordIds([...rows.map((r) => r.actor), ...reverts.map((r) => r.actor)]);
  const actorLabel = (id: string, fallback: string | null) =>
    id === "pending-email" ? "pre-grant by email (automatic)" : actorNames.get(id) ?? fallback ?? "unknown";
  const targetLabel = (t: string) => t.startsWith("pending:")
    ? `pre-grant for ${pendEmail.get(t.slice(8)) ?? "an email (removed)"}`
    : userName.get(t) ?? "a removed person";

  return {
    more,
    changes: changeIds.map((cid) => {
      const rs = rows.filter((r) => r.changeId === cid);
      const first = rs[0];
      const undo = reverts.find((r) => r.revertOf === cid);
      const of = first?.revertOf ? revertedOf.find((r) => r.changeId === first.revertOf) : undefined;
      return {
        changeId: cid,
        at: rs[rs.length - 1]?.at ?? first?.at,
        by: actorLabel(first?.actor ?? "", first?.actorName ?? null),
        note: first?.note ?? null,
        isUndo: !!first?.revertOf,
        undoOfAt: of?.at ?? null,
        undoneAt: undo?.at ?? null,
        undoneBy: undo ? actorLabel(undo.actor, undo.actorName) : null,
        pending: rs.some((r) => r.targetUserId.startsWith("pending:")),
        rows: rs.map((r) => ({
          person: targetLabel(r.targetUserId), personId: r.targetUserId.startsWith("pending:") ? null : r.targetUserId,
          grantId: r.grantId, grant: grantLabel(r.grantId), from: r.oldState, to: r.newState,
        })),
      };
    }),
  };
}

// ---------- presets (AccessRole) ----------
// Presets only fill toggles in the dashboard. Editing or deleting one never changes anyone's access (design default 3).

export async function presetList() {
  const rows = await prisma.accessRole.findMany({ orderBy: { name: "asc" } });
  const names = await namesForDiscordIds(rows.map((r) => r.createdBy ?? ""));
  return rows.map((r) => ({
    id: r.id, name: r.name, description: r.description, grantIds: r.grantIds.filter(isKnownGrant),
    by: r.createdBy ? names.get(r.createdBy) ?? null : null, updatedAt: r.updatedAt,
  }));
}

function presetInput(b: Record<string, unknown>) {
  const name = typeof b.name === "string" ? b.name.trim() : "";
  if (!name || name.length > 60) throw new AccessChangeError("bad_request", "name: 1 to 60 characters");
  const description = typeof b.description === "string" && b.description.trim() ? b.description.trim().slice(0, 200) : null;
  if (!Array.isArray(b.grantIds)) throw new AccessChangeError("bad_request", "grantIds must be a list");
  if (b.grantIds.some((g) => !isKnownGrant(g))) throw new AccessChangeError("bad_request", "unknown grant");
  const grantIds = grantCatalog.map((g) => g.id).filter((id) => (b.grantIds as string[]).includes(id));
  return { name, description, grantIds };
}

function uniqueName(err: unknown): never {
  if ((err as { code?: string })?.code === "P2002") throw new AccessChangeError("conflict", "a preset with that name exists");
  throw err;
}

export async function createPreset(viewer: Viewer, b: Record<string, unknown>) {
  const data = presetInput(b);
  return prisma.accessRole.create({ data: { ...data, createdBy: viewer.actor.discordId } }).catch(uniqueName);
}

export async function updatePreset(id: string, b: Record<string, unknown>) {
  const data = presetInput(b);
  if (!(await prisma.accessRole.findUnique({ where: { id } }))) throw new AccessChangeError("not_found", "no such preset");
  return prisma.accessRole.update({ where: { id }, data }).catch(uniqueName);
}

export async function deletePreset(id: string) {
  const r = await prisma.accessRole.deleteMany({ where: { id } });
  if (r.count === 0) throw new AccessChangeError("not_found", "no such preset");
}
