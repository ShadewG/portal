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

const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok: Boolean(ok) }); console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? "  " + detail : ""}`); };
const code = async (p) => { try { await p; return "ok"; } catch (e) { return e?.code ?? String(e); } };
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
check("tab only: pulse.hiring not usable without pulse", !A.grantAllowed("pulse.hiring", await ctxOf(amino)), `change ${c1.changeId}`);
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

const fp1 = await fingerprint();
check("AppAccess + User flags identical to the start", fp0 === fp1, `${fp0} / ${fp1}`);
const failed = results.filter((r) => !r.ok).length;
console.log(`${results.length - failed}/${results.length} passed`);
await prisma.$disconnect();
process.exit(failed ? 1 : 0);
