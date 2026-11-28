import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getAppById, sections } from "@/lib/apps";
import { getGrant, isKnownGrant } from "@/lib/grants";
import { grantAllowed, grantedIds, isOwner } from "@/lib/access";
import {
  ACCESS_ADMIN_GRANT, AccessChangeError, OWN_ACCESS_REFUSAL, accessLevelOf, canManageAccess, setAccessAdmin, setGrants, targetRefusal, type Actor,
} from "@/lib/accessChanges";
import { publicId, type Viewer } from "@/lib/accessAdmin";
import { nameBook, realName } from "@/lib/peopleNames";
import { UNSAFE_TEXT_CHARS } from "@/lib/feedback";
import { plainFull, plainOf, shortName } from "@/lib/plainNames";

/**
 * "Ask for access" (X6, R-3258 B8, 28 Nov 2026). Anyone signed in may ask for a grant they do not have; the access
 * admins (owner + User.isAccessAdmin) answer in the Requests list at the top of /access. Approve applies the grant
 * through lib/accessChanges.ts setGrants (same rules, audited, Undo in History); an ask for the Access page itself is
 * setAccessAdmin (owner only). Owner-only grants: only the owner answers. Nobody answers their own ask.
 * Nothing is sent anywhere (no Discord, no email): the person sees the answer on their next visit.
 * Logs carry internal ids only (never names, emails, Discord ids or what people typed).
 */

export const MAX_OPEN_PER_PERSON = 10;
export const MAX_ASKS_PER_DAY = 10;
export const TEXT_MAX = 200;
const ANSWERED_DAYS = 14;
const MY_ASKS_DAYS = 30;

const DAY_MS = 86_400_000;
const openKeyOf = (userId: string, grantId: string) => `${userId}|${grantId}`;

/** May a person ask for this? Catalog grants and the Access page; never a personal app or one whose sign-in is off. */
export function askable(grantId: unknown): grantId is string {
  if (grantId === ACCESS_ADMIN_GRANT) return true;
  if (!isKnownGrant(grantId)) return false;
  const app = getAppById(getGrant(grantId)!.app);
  return !!app && !app.allowedDiscordId && !app.signInOff;
}

/** Old or not-in-use tools nobody should ask for (X6 polish, Samuel's look at Home 28 Nov): the Archive group, tiles
 *  with no Portal gate (the grant only shows a tile: FOIA Bot, Departments, Invoicing) and dead apps (Patreon preview:
 *  patreon.insanity.team answers 410, inventory/apps.md). They are never offered and the server refuses an ask. */
const ARCHIVE_APPS = new Set(sections.filter((x) => x.id === "archive").flatMap((x) => x.apps.map((a) => a.id)));
const NOT_IN_USE = new Set(["patreon"]);
export function retiredGrant(grantId: string): boolean {
  if (grantId === ACCESS_ADMIN_GRANT) return false;
  const g = getGrant(grantId);
  if (!g) return true;
  if (ARCHIVE_APPS.has(g.app) || NOT_IN_USE.has(g.app)) return true;
  return g.kind === "app" && getGrant(g.app)?.effect === "tile-only";
}

/** Owner-decided things a plain member may not ask for (X6 polish): every owner-only grant in lib/grants.ts (investor
 *  Cases dashboard, the Hiring grant, Servers in Pulse) and Frontwind Dubbing (confidential, the owner's own list in
 *  lib/frontwindAccess.ts). Takedowns stays askable: the Copyright plan gives people without access an "Ask for access"
 *  button. Owner, access admins and Portal admins may still ask (the owner answers). */
const OWNER_DECIDES = new Set(["frontwind-dubbing"]);
export function ownerDecides(grantId: string): boolean {
  return grantId !== ACCESS_ADMIN_GRANT && (getGrant(grantId)?.ownerOnly === true || OWNER_DECIDES.has(grantId));
}

/** Is this person a plain member (not owner, access admin or Portal admin)? */
async function plainMember(discordId: string): Promise<boolean> {
  return (await accessLevelOf({ discordId, username: null })) === null;
}

/** Why this person may not ask for this grant (a plain line for the no-access page and the 403), null = may ask. */
export async function askRefusal(discordId: string, grantId: string): Promise<string | null> {
  if (retiredGrant(grantId)) return "This is an old tool or one with its own sign-in. It cannot be asked for here.";
  if (ownerDecides(grantId) && (await plainMember(discordId))) {
    return `Only ${(await deciders()).owner} gives this one. It cannot be asked for here.`;
  }
  return null;
}

/** App grant ids this person may ask for (Home "N more apps" list). Owned apps are filtered on Home. */
export async function offeredFor(discordId: string): Promise<string[]> {
  const plain = await plainMember(discordId);
  return sections.flatMap((x) => x.apps).map((a) => a.id)
    .filter((id) => askable(id) && !retiredGrant(id) && !(plain && ownerDecides(id)));
}

/** Only the owner answers this ask (owner-only grants, and naming an access admin). */
export function ownerOnlyAsk(grantId: string): boolean {
  return grantId === ACCESS_ADMIN_GRANT || ownerDecides(grantId);
}

/** One line of text from a person: control characters, line breaks, zero-width marks and bidi overrides become spaces
 *  (the same character class as the feedback note cleaner), trimmed, capped. */
export function cleanLine(v: unknown, max = TEXT_MAX): string | null {
  if (typeof v !== "string") return null;
  const s = v.replace(UNSAFE_TEXT_CHARS, " ").replace(/\s+/g, " ").trim().slice(0, max).trim();
  return s || null;
}

/** Where "Open" goes for a grant (a Portal path; the hand-off checks access again). */
export function openHref(grantId: string): string {
  if (grantId === ACCESS_ADMIN_GRANT) return "/access";
  const g = getGrant(grantId);
  const appId = g?.app ?? grantId;
  const params = new URLSearchParams({ app: appId });
  if (g?.kind === "tab" && appId === "pulse") params.set("next", grantId === "pulse.takedowns" ? "/takedowns/" : `/#${grantId.slice(6)}`);
  return `/api/auth/redirect?${params.toString()}`;
}

/** What approving does, for the access admin, when it is not simply "they can open it now". */
export function approveNote(grantId: string): string | null {
  if (grantId === ACCESS_ADMIN_GRANT) return "Makes them an access admin: they can then give and take access for others.";
  const g = getGrant(grantId);
  if (!g) return null;
  const app = getAppById(g.app);
  if (grantId === "pulse.hiring") return "Opens Hiring only for trials where the hub names them as reviewer.";
  if (grantId === "pulse.servers" || grantId === "pulse.takedowns") {
    return `Saved here, but ${plainOf(grantId).name} still checks its own list (until 18 Dec): add them there too.`;
  }
  if (g.kind === "tab") return `Saved here, but ${plainFull(grantId)} does not check it yet.`;
  if (app?.allowAnyAuthenticatedUser) return "Everyone signed in can open this already.";
  if (g.effect === "none") return `${plainOf(grantId).name} uses its own list: the grant alone does not open it.`;
  if (g.effect === "next-sign-in") return "Works the next time they open it from Home.";
  if (g.effect === "tile-only") return "Shows the tile on Home. The app has its own sign-in.";
  return null;
}

/** "A", "A or B", "A, B or C". */
export function joinOr(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}`;
}

/** Names of the people who answer asks: the owner first, then the access admins (real names when Desk knows them). */
export async function deciders(): Promise<{ owner: string; all: string[] }> {
  const owner = process.env.ADMIN_DISCORD_ID ?? "";
  const rows = await prisma.user.findMany({
    where: { OR: [{ isAccessAdmin: true }, ...(owner ? [{ discordId: owner }] : [])] },
    select: { discordId: true, username: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });
  const book = await nameBook();
  const nameOf = (u: { discordId: string; username: string }) => shortName(u.username, realName(book, u));
  const ownerRow = rows.find((r) => isOwner(r.discordId));
  const ownerName = ownerRow ? nameOf(ownerRow) : "the owner";
  return { owner: ownerName, all: [ownerName, ...rows.filter((r) => !isOwner(r.discordId)).map(nameOf)] };
}

/** Does this person have the grant now (the one rule in lib/access.ts; the Access page = may manage access)? */
async function hasNow(user: { id: string; discordId: string; isAdmin: boolean }, grantId: string, granted?: Set<string>): Promise<boolean> {
  if (grantId === ACCESS_ADMIN_GRANT) return canManageAccess({ discordId: user.discordId });
  return grantAllowed(grantId, {
    discordId: user.discordId, user: { discordId: user.discordId }, isAdmin: user.isAdmin || isOwner(user.discordId),
    granted: granted ?? (await grantedIds(user.id)),
  });
}

/** Open asks whose person already holds the grant (given by a toggle, not by Approve, or a crash after the grant was
 *  saved): ids of those rows. Home ("N asked", Your asks) and the Requests list both leave them out (F9), so the badge
 *  and the rows always come from the same answer. One grants query per person. */
async function heldOpenAsks(rows: Row[], users: Map<string, { id: string; discordId: string; isAdmin: boolean }>): Promise<Set<string>> {
  const held = new Set<string>();
  const grants = new Map<string, Set<string>>();
  for (const r of rows) {
    if (r.state !== "open" && r.state !== "approving") continue;
    const u = users.get(r.userId);
    if (!u) continue;
    if (!grants.has(u.id)) grants.set(u.id, await grantedIds(u.id));
    if (await hasNow(u, r.grantId, grants.get(u.id))) held.add(r.id);
  }
  return held;
}

type Row = Prisma.AccessRequestGetPayload<object>;
const answerOf = (r: Row | null) => r && r.state !== "open" && r.state !== "approving"
  ? { state: r.state as "approved" | "declined", at: r.decidedAt?.toISOString() ?? null, by: r.decidedByName, note: r.decisionNote }
  : null;

export interface NoAccessView {
  grantId: string; name: string; line: string; full: string; holderNote: string | null;
  deciders: string; ownerOnly: boolean; has: boolean; openHref: string;
  open: { at: string } | null; last: ReturnType<typeof answerOf>;
  /** Set when this person may not ask (old tool, or owner-decided for a plain member): shown instead of the button. */
  refused: string | null;
}

/** Everything the no-access page shows for one signed-in person and one grant. Unknown or personal grant = null. */
export async function noAccessView(discordId: string, grantId: unknown): Promise<NoAccessView | null> {
  if (!askable(grantId)) return null;
  const user = await prisma.user.findUnique({ where: { discordId }, select: { id: true, discordId: true, isAdmin: true } });
  const plain = plainOf(grantId, getGrant(grantId)?.label);
  const who = await deciders();
  const ownerOnly = ownerOnlyAsk(grantId);
  const latest = user ? await prisma.accessRequest.findFirst({ where: { userId: user.id, grantId }, orderBy: { createdAt: "desc" } }) : null;
  const isOpen = latest?.state === "open" || latest?.state === "approving";
  return {
    grantId, name: plain.name, line: plain.line, full: plainFull(grantId), holderNote: plain.holderNote ?? null,
    deciders: ownerOnly ? who.owner : joinOr(who.all), ownerOnly,
    has: user ? await hasNow(user, grantId) : false,
    openHref: openHref(grantId),
    open: isOpen && latest ? { at: latest.createdAt.toISOString() } : null,
    last: isOpen ? null : answerOf(latest),
    refused: await askRefusal(discordId, grantId),
  };
}

/** Ask for a grant. Already have it: { state: "has" }. Already asked: the open ask (never a second row). */
export async function createAsk(discordId: string, grantId: unknown, reasonIn: unknown): Promise<{ state: "open" | "has"; at?: string; already?: boolean }> {
  if (!askable(grantId)) throw new AccessChangeError("bad_request", "You cannot ask for this here.");
  const refused = await askRefusal(discordId, grantId);
  if (refused) throw new AccessChangeError("forbidden", refused);
  const user = await prisma.user.findUnique({ where: { discordId }, select: { id: true, discordId: true, isAdmin: true } });
  if (!user) throw new AccessChangeError("forbidden", "Sign in again, then ask.");
  if (await hasNow(user, grantId)) return { state: "has" };
  const open = await prisma.accessRequest.findUnique({ where: { openKey: openKeyOf(user.id, grantId) } });
  if (open) return { state: "open", at: open.createdAt.toISOString(), already: true };
  if ((await prisma.accessRequest.count({ where: { userId: user.id, state: { in: ["open", "approving"] } } })) >= MAX_OPEN_PER_PERSON) {
    throw new AccessChangeError("conflict", `You have ${MAX_OPEN_PER_PERSON} asks waiting. Wait for an answer first.`);
  }
  if ((await prisma.accessRequest.count({ where: { userId: user.id, createdAt: { gte: new Date(Date.now() - DAY_MS) } } })) >= MAX_ASKS_PER_DAY) {
    throw new AccessChangeError("conflict", "That is a lot of asks for one day. Try again tomorrow.");
  }
  try {
    const row = await prisma.accessRequest.create({
      data: { userId: user.id, grantId, reason: cleanLine(reasonIn), openKey: openKeyOf(user.id, grantId) },
    });
    console.log("[access] ask", { userId: user.id, grantId, id: row.id });
    return { state: "open", at: row.createdAt.toISOString() };
  } catch (err) {
    if ((err as { code?: string })?.code !== "P2002") throw err;
    // two clicks at once: the other one made the row
    const again = await prisma.accessRequest.findUnique({ where: { openKey: openKeyOf(user.id, grantId) } });
    if (!again) throw err;
    return { state: "open", at: again.createdAt.toISOString(), already: true };
  }
}

/** The person's own asks of the last 30 days, newest per grant first (Home). */
export async function myAsks(discordId: string) {
  const user = await prisma.user.findUnique({ where: { discordId }, select: { id: true, discordId: true, isAdmin: true } });
  if (!user) return [];
  const rows = await prisma.accessRequest.findMany({
    where: { userId: user.id, createdAt: { gte: new Date(Date.now() - MY_ASKS_DAYS * DAY_MS) } },
    orderBy: { createdAt: "desc" }, take: 50,
  });
  const seen = new Set<string>();
  const latest = rows.filter((r) => !seen.has(r.grantId) && seen.add(r.grantId));
  const held = await heldOpenAsks(latest, new Map([[user.id, user]]));
  return latest.filter((r) => !held.has(r.id)).map((r) => ({
    grantId: r.grantId, name: plainFull(r.grantId),
    state: r.state === "approving" ? "open" : r.state,
    at: r.createdAt.toISOString(), answeredAt: r.decidedAt?.toISOString() ?? null, by: r.decidedByName, note: r.decisionNote,
  }));
}

/** Why this viewer may not answer this ask (null = may). Same rules as the change itself. */
function answerRefusal(viewer: Viewer, grantId: string, target: { discordId: string }, ownerName: string): string | null {
  if (viewer.can !== "manage") return "read only";
  if (ownerOnlyAsk(grantId) && !viewer.isOwner) return `Only ${ownerName} can answer this one.`;
  const why = targetRefusal(viewer.actor, viewer.level, target);
  if (why === OWN_ACCESS_REFUSAL) return "You cannot answer your own ask.";
  return why ? `Only ${ownerName} can answer this one.` : null;
}

/** Requests list for /access: open asks oldest first, then answers of the last 14 days. Owner, access admins, and
 *  Portal admins (read only: canAnswer false on every row). */
export async function requestsFor(viewer: Viewer) {
  const since = new Date(Date.now() - ANSWERED_DAYS * DAY_MS);
  const [open, answered] = await Promise.all([
    prisma.accessRequest.findMany({ where: { state: { in: ["open", "approving"] } }, orderBy: { createdAt: "asc" }, take: 200 }),
    prisma.accessRequest.findMany({ where: { state: { in: ["approved", "declined"] }, decidedAt: { gte: since } }, orderBy: { decidedAt: "desc" }, take: 40 }),
  ]);
  const rows = [...open, ...answered];
  const users = rows.length ? await prisma.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.userId))] } }, select: { id: true, discordId: true, username: true, isAdmin: true } }) : [];
  const byId = new Map(users.map((u) => [u.id, u]));
  const held = await heldOpenAsks(open, byId);
  const changeIds = answered.map((r) => r.changeId).filter((c): c is string => !!c);
  const undone = new Set(changeIds.length
    ? (await prisma.accessAudit.findMany({ where: { revertOf: { in: changeIds } }, select: { revertOf: true } })).map((r) => r.revertOf)
    : []);
  const book = await nameBook();
  const { owner } = await deciders();
  const shape = (r: Row) => {
    const u = byId.get(r.userId);
    if (!u) return null; // the person was removed from Portal
    const refusal = answerRefusal(viewer, r.grantId, u, owner);
    return {
      id: r.id,
      person: { id: publicId(viewer, u.id), name: realName(book, u), username: u.username },
      grantId: r.grantId, grant: plainFull(r.grantId), line: plainOf(r.grantId).line, approveNote: approveNote(r.grantId),
      ownerOnly: ownerOnlyAsk(r.grantId), reason: r.reason, at: r.createdAt.toISOString(),
      state: r.state === "approving" ? "open" : r.state,
      canAnswer: refusal === null, whyNot: refusal === "read only" ? null : refusal,
      answeredAt: r.decidedAt?.toISOString() ?? null, by: r.decidedByName, note: r.decisionNote,
      changeId: r.changeId, undone: !!r.changeId && undone.has(r.changeId),
    };
  };
  const nonNull = <T,>(x: T | null): x is T => x !== null;
  return { open: open.filter((r) => !held.has(r.id)).map(shape).filter(nonNull), answered: answered.map(shape).filter(nonNull) };
}

/** Number of asks waiting that this viewer can answer (Home badge on the Access link). */
export async function waitingFor(viewer: Viewer): Promise<number> {
  if (viewer.can !== "manage") return 0;
  const { open } = await requestsFor(viewer);
  return open.filter((r) => r.canAnswer).length;
}

/** An "approving" claim older than this is treated as open again: the process that claimed it died (deploy, OOM)
 *  before the final update, or the reset after a refusal failed (F2). setGrants is idempotent, so a second approve of a
 *  grant that was already saved closes the ask with "already had it". */
export const STALE_APPROVING_MS = 2 * 60_000;
const staleClaim = (r: { state: string; decidedAt: Date | null }) =>
  r.state === "approving" && (!r.decidedAt || Date.now() - r.decidedAt.getTime() > STALE_APPROVING_MS);

/**
 * Approve or decline one ask. The ask is claimed first (open -> approving / declined, one row update, so two admins
 * never both answer); approve then calls setGrants / setAccessAdmin, which check every rule again. If that refuses,
 * the ask goes back to open and the refusal comes back as it is.
 */
export async function answerAsk(viewer: Viewer, id: unknown, action: unknown, noteIn: unknown) {
  if (typeof id !== "string" || !id) throw new AccessChangeError("bad_request", "id is required");
  if (action !== "approve" && action !== "decline") throw new AccessChangeError("bad_request", "action must be approve or decline");
  if (viewer.can !== "manage") throw new AccessChangeError("forbidden", "You can look but not change access.");
  const actor: Actor = viewer.actor;
  const note = cleanLine(noteIn);
  const req = await prisma.accessRequest.findUnique({ where: { id } });
  if (!req) throw new AccessChangeError("not_found", "no such ask");
  if (req.state !== "open" && !staleClaim(req)) throw new AccessChangeError("conflict", req.decidedByName ? `Already answered by ${req.decidedByName}.` : "Already answered.");
  const target = await prisma.user.findUnique({ where: { id: req.userId }, select: { id: true, discordId: true } });
  if (!target) throw new AccessChangeError("conflict", "This person is no longer in Portal.");
  const { owner } = await deciders();
  const refusal = answerRefusal(viewer, req.grantId, target, owner);
  if (refusal) throw new AccessChangeError("forbidden", refusal);

  // the name the person will read ("Declined by Ayoub"), not a Discord handle
  const byName = shortName(actor.username ?? "", realName(await nameBook(), { discordId: actor.discordId, username: actor.username ?? "" }));
  const decided = { decidedAt: new Date(), decidedBy: actor.discordId, decidedByName: byName, decisionNote: note };
  const claim = await prisma.accessRequest.updateMany({
    where: {
      id,
      OR: [{ state: "open" }, { state: "approving", decidedAt: { lt: new Date(Date.now() - STALE_APPROVING_MS) } }, { state: "approving", decidedAt: null }],
    },
    data: action === "decline" ? { state: "declined", openKey: null, ...decided } : { state: "approving", ...decided },
  });
  if (claim.count !== 1) throw new AccessChangeError("conflict", "Someone answered this ask a moment ago. Reload.");
  if (action === "decline") {
    console.log("[access] ask declined", { id });
    return { state: "declined" as const, changeId: null };
  }
  let r: { changeId: string | null };
  try {
    r = req.grantId === ACCESS_ADMIN_GRANT
      ? await setAccessAdmin(actor, req.userId, true, note ? `ask approved: ${note}` : "ask approved")
      : await setGrants(actor, req.userId, [{ grantId: req.grantId, granted: true }], note ? `ask approved: ${note}` : "ask approved");
  } catch (err) {
    // the change was refused or failed: nothing was granted, the ask goes back to open (if this reset fails too, the
    // claim goes stale after STALE_APPROVING_MS and can be answered again)
    await prisma.accessRequest.updateMany({
      where: { id, state: "approving" }, data: { state: "open", decidedAt: null, decidedBy: null, decidedByName: null, decisionNote: null },
    }).catch(() => undefined);
    throw err;
  }
  // The grant is saved (audited, Undo in History). If closing the ask fails, do NOT put it back to open: the person
  // holds the grant, so Home and the Requests list leave the row out (heldOpenAsks), and the stale claim can be closed
  // by a later answer. The Undo link still comes back to the approver.
  try {
    await prisma.accessRequest.update({ where: { id }, data: { state: "approved", openKey: null, changeId: r.changeId } });
  } catch (err) {
    console.error("[access] ask approved but not closed", { id, changeId: r.changeId, code: (err as { code?: string })?.code ?? "unknown" });
  }
  console.log("[access] ask approved", { id, changeId: r.changeId });
  return { state: "approved" as const, changeId: r.changeId };
}
