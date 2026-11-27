#!/usr/bin/env node
// DEV ONLY (R-2159 M2): exercises setGrants / revertChange / setAccessAdmin against portal_dev and puts every row back.
//   cd /opt/access-dev/portal && node --experimental-strip-types --no-warnings tools/m2_changes_test.mjs
// Refuses unless DATABASE_URL names portal_dev. Ends by comparing a fingerprint of AppAccess + User.isAccessAdmin with
// the one taken at the start (must be equal). AccessAudit rows written by the test stay (they are the evidence).
import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { pathToFileURL, fileURLToPath } from "node:url";
import path from "node:path";
import dotenv from "dotenv";
import pg from "pg";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: path.join(root, ".env"), quiet: true });
if (!/\/portal_dev(\?|$)/.test(process.env.DATABASE_URL ?? "")) { console.error("refused: DATABASE_URL is not portal_dev"); process.exit(2); }
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@/lib/db") return { url: `data:text/javascript,${encodeURIComponent("export const prisma = globalThis.__t.prisma;")}`, shortCircuit: true };
    if (specifier.startsWith("@/")) {
      const base = path.join(root, specifier.slice(2));
      return { url: pathToFileURL([".ts", ".tsx"].map((e) => base + e).find(existsSync)).href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});
const prisma = new PrismaClient({ adapter: new PrismaPg(new pg.Pool({ connectionString: process.env.DATABASE_URL })) });
globalThis.__t = { prisma };
const C = await import(pathToFileURL(path.join(root, "lib/accessChanges.ts")).href);
const A = await import(pathToFileURL(path.join(root, "lib/access.ts")).href);
const P = await import(pathToFileURL(path.join(root, "lib/pendingAccess.ts")).href);
const G = await import(pathToFileURL(path.join(root, "lib/apps.ts")).href);

const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok: Boolean(ok) }); console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? "  " + detail : ""}`); };
const code = async (p) => { try { await p; return "ok"; } catch (e) { return e?.code ?? String(e); } };
const msg = async (p) => { try { await p; return "ok"; } catch (e) { return e?.message ?? String(e); } };
async function fingerprint() {
  const a = await prisma.appAccess.findMany({ orderBy: { id: "asc" } });
  const u = await prisma.user.findMany({ orderBy: { id: "asc" }, select: { id: true, isAccessAdmin: true, isAdmin: true } });
  return createHash("sha256").update(JSON.stringify([a, u])).digest("hex").slice(0, 16);
}
const byName = async (n) => prisma.user.findFirstOrThrow({ where: { username: n } });
const rowsOf = async (id) => JSON.stringify(await prisma.appAccess.findMany({ where: { userId: id }, orderBy: { appId: "asc" } }));
async function ctxOf(u) { return { discordId: u.discordId, user: { discordId: u.discordId }, isAdmin: u.isAdmin || A.isOwner(u.discordId), granted: await A.grantedIds(u.id) }; }

const fp0 = await fingerprint();
const owner = await prisma.user.findFirstOrThrow({ where: { discordId: process.env.ADMIN_DISCORD_ID } });
const hareld = await byName("hareld"), atom = await byName("atomboy7"), amino = await byName("amino1473");
const O = { discordId: owner.discordId, username: owner.username };
const H = { discordId: hareld.discordId, username: hareld.username };
const T = { discordId: atom.discordId, username: atom.username };

check("owner can manage", await C.canManageAccess(O));
check("Portal admin (hareld) cannot manage", !(await C.canManageAccess(H)));
check("non-admin (atomboy7) cannot manage", !(await C.canManageAccess(T)));
check("empty actor cannot manage", !(await C.canManageAccess({ discordId: "" })) && !(await C.canManageAccess(null)));
check("setGrants as Portal admin refused", (await code(C.setGrants(H, amino.id, [{ grantId: "pulse", granted: true }]))) === "forbidden");
const aminoBefore = await rowsOf(amino.id);
check("unknown grant refused, nothing written", (await code(C.setGrants(O, amino.id, [{ grantId: "pulse", granted: true }, { grantId: "nope.x", granted: true }]))) === "bad_request" && (await rowsOf(amino.id)) === aminoBefore);
check("missing user refused", (await code(C.setGrants(O, "no-such-user", [{ grantId: "pulse", granted: true }]))) === "not_found");

// tab + parent rule
const c1 = await C.setGrants(O, amino.id, [{ grantId: "pulse.hiring", granted: true }], "m2 test: tab only");
check("tab only: pulse.hiring usable without pulse (gate rule tab, M4)", A.grantAllowed("pulse.hiring", await ctxOf(amino)) && !A.grantAllowed("pulse", await ctxOf(amino)), `change ${c1.changeId}`);
check("tab only: pulse.hiring row admits the Pulse handoff (M4)", A.handoffAllowed(G.getAppById("pulse"), await ctxOf(amino)));
// M4: only tabs with a gate rule (SHELL_TABS) count without the app; pulse.servers / pulse.takedowns rows alone do not
for (const t of ["pulse.servers", "pulse.takedowns"]) {
  const ctxT = { discordId: "900000000000000099", user: { discordId: "900000000000000099" }, isAdmin: false, granted: new Set([t]) };
  check(`tab only: ${t} not usable and no Pulse handoff without pulse`, !A.grantAllowed(t, ctxT) && !A.handoffAllowed(G.getAppById("pulse"), ctxT));
}
const c2 = await C.setGrants(O, amino.id, [{ grantId: "pulse", granted: true }], "m2 test: add app");
check("tab + app: pulse.hiring usable", A.grantAllowed("pulse.hiring", await ctxOf(amino)) && A.grantAllowed("pulse", await ctxOf(amino)));
check("tab + app: pulse.servers still not usable", !A.grantAllowed("pulse.servers", await ctxOf(amino)));
const audit2 = await prisma.accessAudit.findMany({ where: { changeId: c2.changeId } });
check("audit row written in the same change", audit2.length === 1 && audit2[0].oldState === "none" && audit2[0].newState === "on" && audit2[0].actor === O.discordId);
const noop = await C.setGrants(O, amino.id, [{ grantId: "pulse", granted: true }]);
check("no-op change writes nothing", noop.changeId === null && noop.applied.length === 0);
check("revert out of order refused (c1 grant unchanged, c2 fine) -> revert c2", (await code(C.revertChange(O, c2.changeId))) === "ok");
check("revert twice refused", (await code(C.revertChange(O, c2.changeId))) === "conflict");
await C.revertChange(O, c1.changeId);
check("amino rows back exactly", (await rowsOf(amino.id)) === aminoBefore);

// conflict: changed since
const atomBefore = await rowsOf(atom.id);
const a1 = await C.setGrants(O, atom.id, [{ grantId: "desk", granted: false }, { grantId: "foia-sorter", granted: false }], "m2 test: revoke two");
const a2 = await C.setGrants(O, atom.id, [{ grantId: "desk", granted: true }], "m2 test: desk back");
check("revert of an older change refused when a grant changed since", (await code(C.revertChange(O, a1.changeId))) === "conflict");
await C.revertChange(O, a2.changeId);
await C.revertChange(O, a1.changeId);
check("atomboy7 rows back exactly (incl. grantedBy, grantedAt)", (await rowsOf(atom.id)) === atomBefore);

// access admins
check("access admin by non-owner refused", (await code(C.setAccessAdmin(H, atom.id, true))) === "forbidden");
const m1 = await C.setAccessAdmin(O, atom.id, true, "m2 test");
check("named access admin can manage", await C.canManageAccess(T));
check("access admin cannot name access admins", (await code(C.setAccessAdmin(T, amino.id, true))) === "forbidden");
const t1 = await C.setGrants(T, amino.id, [{ grantId: "patreon", granted: true }], "m2 test: by access admin");
check("access admin change logged with their id", (await prisma.accessAudit.findFirst({ where: { changeId: t1.changeId } }))?.actor === T.discordId);
check("access admin cannot revert an access-admin change", (await code(C.revertChange(T, m1.changeId))) === "forbidden");
await C.revertChange(T, t1.changeId);
await C.revertChange(O, m1.changeId);
check("access admin flag back off", !(await C.canManageAccess(T)));

// ---- review fixes (25 Nov) ----
// revert of a revert (P2025 before the fix), double revert
const takeBefore = await rowsOf(amino.id);
const k1 = await C.setGrants(O, amino.id, [{ grantId: "pulse.takedowns", granted: true }], "m2 fix test: create");
const rowAfterK1 = await prisma.appAccess.findUnique({ where: { userId_appId: { userId: amino.id, appId: "pulse.takedowns" } } });
const k2 = await C.revertChange(O, k1.changeId);
check("revert deletes the row it created", !(await prisma.appAccess.findUnique({ where: { userId_appId: { userId: amino.id, appId: "pulse.takedowns" } } })));
let k3 = null;
check("revert of a revert works (row was deleted)", (await code(C.revertChange(O, k2.changeId).then((r) => { k3 = r; }))) === "ok");
const rowAfterK3 = await prisma.appAccess.findUnique({ where: { userId_appId: { userId: amino.id, appId: "pulse.takedowns" } } });
check("revert of a revert restores the row exactly (granted, grantedBy, grantedAt)",
  rowAfterK3 && rowAfterK3.granted === rowAfterK1.granted && rowAfterK3.grantedBy === rowAfterK1.grantedBy && +rowAfterK3.grantedAt === +rowAfterK1.grantedAt);
check("double revert of the revert refused", (await code(C.revertChange(O, k2.changeId))) === "conflict");
check("double revert of the original refused", (await code(C.revertChange(O, k1.changeId))) === "conflict");
await C.revertChange(O, k3.changeId);
check("amino rows back after revert chain", (await rowsOf(amino.id)) === takeBefore);

// changed since, although the state is the same again
const s1 = await C.setGrants(O, amino.id, [{ grantId: "pulse.servers", granted: true }], "m2 fix test: s1 on");
const s2 = await C.setGrants(O, amino.id, [{ grantId: "pulse.servers", granted: false }], "m2 fix test: s2 off");
const s3 = await C.setGrants(O, amino.id, [{ grantId: "pulse.servers", granted: true }], "m2 fix test: s3 on");
check("revert refused when the grant changed since even if the state matches", (await code(C.revertChange(O, s1.changeId))) === "conflict");
await C.revertChange(O, s3.changeId); await C.revertChange(O, s2.changeId);
check("undo in reverse order still works", (await code(C.revertChange(O, s1.changeId))) === "ok");
check("amino rows back after s1..s3", (await rowsOf(amino.id)) === takeBefore);

// error text never echoes input
check("unknown grant error does not echo the input", (await msg(C.setGrants(O, amino.id, [{ grantId: "<script>x", granted: true }]))) === "unknown grant");

// Portal admin (hareld, not access admin) through the old /admin routes
const hBefore = await rowsOf(hareld.id), oBefore = await rowsOf(owner.id);
check("Portal admin without allowPortalAdmin refused", (await code(C.setGrants(H, amino.id, [{ grantId: "patreon", granted: true }]))) === "forbidden");
const h1 = await C.setGrants(H, amino.id, [{ grantId: "patreon", granted: true }], "m2 fix test: portal admin app grant", { allowPortalAdmin: true });
check("Portal admin may still set an app grant (old /admin route), audited", h1.changeId && (await prisma.accessAudit.count({ where: { changeId: h1.changeId } })) === 1);
check("Portal admin refused for a tab grant", (await code(C.setGrants(H, amino.id, [{ grantId: "pulse.hiring", granted: true }], null, { allowPortalAdmin: true }))) === "forbidden");
check("Portal admin refused for the owner", (await code(C.setGrants(H, owner.id, [{ grantId: "patreon", granted: false }], null, { allowPortalAdmin: true }))) === "forbidden");
check("Portal admin refused for themselves", (await code(C.setGrants(H, hareld.id, [{ grantId: "patreon", granted: true }], null, { allowPortalAdmin: true }))) === "forbidden");
await C.revertChange(O, h1.changeId);
check("hareld + owner rows untouched", (await rowsOf(hareld.id)) === hBefore && (await rowsOf(owner.id)) === oBefore);

// target guards for an access admin; owner may change own grants
const g0 = await C.setAccessAdmin(O, atom.id, true, "m2 fix test");
check("access admin refused for the owner", (await code(C.setGrants(T, owner.id, [{ grantId: "patreon", granted: true }]))) === "forbidden");
check("access admin refused for themselves", (await code(C.setGrants(T, atom.id, [{ grantId: "patreon", granted: true }]))) === "forbidden");
const ow = await C.setGrants(O, owner.id, [{ grantId: "pulse.takedowns", granted: true }], "m2 fix test: owner on own");
check("owner may change own grants", ow.changeId !== null);
check("access admin cannot revert a change to the owner", (await code(C.revertChange(T, ow.changeId))) === "forbidden");
await C.revertChange(O, ow.changeId);
await C.revertChange(O, g0.changeId);
check("owner rows back", (await rowsOf(owner.id)) === oBefore);

// pre-grants by email (old /admin pending route)
const aminoEmail = (await prisma.user.findUniqueOrThrow({ where: { id: amino.id } })).email;
check("pre-grant: unknown grant refused", (await code(C.setPendingGrant(O, aminoEmail, "nope.x", true))) === "bad_request");
check("pre-grant: Portal admin refused for a tab", (await code(C.setPendingGrant(H, aminoEmail, "pulse.hiring", true, { allowPortalAdmin: true }))) === "forbidden");
const pg1 = await C.setPendingGrant(H, aminoEmail, "patreon", true, { allowPortalAdmin: true });
const pgAudit = await prisma.accessAudit.findFirst({ where: { changeId: pg1.changeId } });
check("pre-grant: Portal admin app pre-grant audited (target pending:<id>, no email)", pgAudit?.targetUserId.startsWith("pending:") && !JSON.stringify(pgAudit).includes(aminoEmail));
check("pre-grant change cannot be reverted with revertChange", (await code(C.revertChange(O, pg1.changeId))) === "bad_request");
// an unknown id written straight into the table (as the old route allowed) is skipped and stays unresolved
await prisma.pendingAppAccess.create({ data: { id: "m2fixunknown", email: aminoEmail, appId: "nope.unknown", granted: true, grantedBy: "m2-test" } });
const warns = []; const realWarn = console.warn; console.warn = (...a) => warns.push(a);
await P.applyPendingGrants({ id: amino.id, email: aminoEmail }, { email: aminoEmail, emailVerified: false });
await P.applyPendingGrants({ id: amino.id, email: aminoEmail }, { email: aminoEmail, emailVerified: false });
console.warn = realWarn;
check("unverified skip + unknown skip logged once each over 2 calls", warns.length === 2 && !JSON.stringify(warns).includes(aminoEmail), `warns=${warns.length}`);
await P.applyPendingGrants({ id: amino.id, email: aminoEmail }, { email: aminoEmail, emailVerified: true });
const patreonRow = await prisma.appAccess.findUnique({ where: { userId_appId: { userId: amino.id, appId: "patreon" } } });
check("verified apply: known pre-grant applied with old row values (grantedBy null)", patreonRow?.granted === true && patreonRow.grantedBy === null);
check("verified apply: unknown pre-grant not applied, still unresolved",
  !(await prisma.appAccess.findUnique({ where: { userId_appId: { userId: amino.id, appId: "nope.unknown" } } })) &&
  (await prisma.pendingAppAccess.findUnique({ where: { id: "m2fixunknown" } }))?.resolvedAt === null);
await prisma.appAccess.delete({ where: { id: patreonRow.id } });
await prisma.pendingAppAccess.deleteMany({ where: { id: "m2fixunknown" } });
check("pre-grant delete audited", (await code(C.deletePendingGrant(H, aminoEmail, "patreon", { allowPortalAdmin: true }))) === "ok");
check("amino rows back after pre-grant tests", (await rowsOf(amino.id)) === takeBefore);

// Desk stickiness: a pre-grant on an auto-managed Desk row keeps grantedBy/grantedAt (old apply behavior)
const autoDesk = await prisma.appAccess.findFirst({ where: { appId: "desk", grantedBy: "auto:discord-team" }, include: { user: true } });
if (autoDesk?.user.email) {
  await prisma.appAccess.update({ where: { id: autoDesk.id }, data: { granted: false } });
  await prisma.pendingAppAccess.create({ data: { id: "m2fixdesk", email: autoDesk.user.email, appId: "desk", granted: true, grantedBy: "m2-test" } });
  await P.applyPendingGrants({ id: autoDesk.userId, email: autoDesk.user.email }, { email: autoDesk.user.email, emailVerified: true });
  const after = await prisma.appAccess.findUnique({ where: { id: autoDesk.id } });
  const aud = await prisma.accessAudit.findFirst({ where: { targetUserId: autoDesk.userId, grantId: "desk", actor: "pending-email" }, orderBy: { at: "desc" } });
  check("pre-grant on auto Desk row: granted on, grantedBy + grantedAt unchanged, audit written",
    after.granted === true && after.grantedBy === "auto:discord-team" && +after.grantedAt === +autoDesk.grantedAt && aud?.newState === "on");
  await prisma.appAccess.update({ where: { id: autoDesk.id }, data: { granted: autoDesk.granted, grantedBy: autoDesk.grantedBy, grantedAt: autoDesk.grantedAt } });
  await prisma.pendingAppAccess.deleteMany({ where: { id: "m2fixdesk" } });
} else check("auto Desk row with an email exists for the stickiness test", false);

const fp1 = await fingerprint();
check("AppAccess + User flags identical to the start", fp0 === fp1, `${fp0} / ${fp1}`);
const failed = results.filter((r) => !r.ok).length;
console.log(`${results.length - failed}/${results.length} passed`);
await prisma.$disconnect();
process.exit(failed ? 1 : 0);
