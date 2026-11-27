#!/usr/bin/env node
// DEV ONLY (R-2159 M2 mirror proof). For every user in portal_dev, compute access with the OLD code (a checkout of
// the commit before M2) and the NEW shared rule (lib/access.ts), and print every difference.
//
//   cd /opt/access-dev/portal && node --experimental-strip-types --no-warnings tools/m2_mirror.mjs <old-checkout-dir>
//
// Compared per user: (1) the /api/me JSON (old route vs new route, run in-process), (2) permittedAppIds (used by
// /api/apps and the Desk / Video Review tokens), (3) the /api/auth/redirect access decision for every app incl. the
// sign-in-only app, (4) the new /api/access/check answer for every app grant vs the new /api/me map. Tab grants and an
// unknown grant are listed with who gets them. The database is read only: every write the routes try is blocked and
// counted (expected 0). Refuses unless DATABASE_URL names portal_dev. Prints no emails and no env values.
import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
import { pathToFileURL, fileURLToPath } from "node:url";
import path from "node:path";
import dotenv from "dotenv";
import pg from "pg";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const oldRoot = path.resolve(process.argv[2] ?? "");
dotenv.config({ path: path.join(root, ".env"), quiet: true });
if (!/\/portal_dev(\?|$)/.test(process.env.DATABASE_URL ?? "")) { console.error("m2_mirror: refused: DATABASE_URL is not portal_dev"); process.exit(2); }
if (!existsSync(path.join(oldRoot, "lib/access.ts")) || oldRoot === root) { console.error("usage: m2_mirror.mjs <old-checkout-dir>"); process.exit(1); }

const fakes = {
  "@/auth": "export const auth = async () => globalThis.__m2.session;",
  "@/lib/db": "export const prisma = new Proxy({}, { get: (_, k) => globalThis.__m2.prisma[k] });",
};
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (fakes[specifier]) return { url: `data:text/javascript,${encodeURIComponent(fakes[specifier])}`, shortCircuit: true };
    if (specifier.startsWith("@/")) {
      const parent = context.parentURL ? fileURLToPath(context.parentURL) : "";
      const base = path.join(parent.startsWith(oldRoot + path.sep) ? oldRoot : root, specifier.slice(2));
      const file = [".ts", ".tsx"].map((ext) => base + ext).find(existsSync);
      return { url: pathToFileURL(file).href, shortCircuit: true };
    }
    return nextResolve(/^next\/[a-z-]+$/.test(specifier) ? `${specifier}.js` : specifier, context);
  },
});

const real = new PrismaClient({ adapter: new PrismaPg(new pg.Pool({ connectionString: process.env.DATABASE_URL })) });
const writes = [];
const READS = new Set(["findMany", "findUnique", "findFirst", "count"]);
function readOnlyModel(name) {
  return new Proxy({}, {
    get(_, op) {
      if (READS.has(op)) return (...a) => real[name][op](...a);
      if (name === "user" && op === "upsert") {
        // the routes upsert the signed-in user with the values the session already has: read it instead
        return async ({ where, update, include }) => {
          const u = await real.user.findUnique({ where, include });
          if (!u) throw new Error("m2_mirror: user vanished");
          return { ...u, ...(update?.isAdmin ? { isAdmin: true } : {}) };
        };
      }
      return async (...a) => { writes.push(`${name}.${String(op)}`); return op.endsWith("Many") ? { count: 0 } : null; };
    },
  });
}
const ro = new Proxy({}, {
  get(_, k) {
    if (k === "$transaction") return async (arg) => { writes.push("$transaction"); return typeof arg === "function" ? arg(ro) : []; };
    if (typeof k === "string" && !k.startsWith("$")) return readOnlyModel(k);
    return undefined;
  },
});
globalThis.__m2 = { session: null, prisma: ro };

const imp = (dir, f) => import(pathToFileURL(path.join(dir, f)).href);
const oldMe = (await imp(oldRoot, "app/api/me/route.ts")).GET;
const oldAccess = await imp(oldRoot, "lib/access.ts");
const oldApps = await imp(oldRoot, "lib/apps.ts");
const oldCases = await imp(oldRoot, "lib/casesAccess.ts");
const oldFront = await imp(oldRoot, "lib/frontwindAccess.ts");
const newMe = (await imp(root, "app/api/me/route.ts")).GET;
const newCheck = (await imp(root, "app/api/access/check/route.ts")).GET;
const newAccess = await imp(root, "lib/access.ts");
const { allApps, getAppById } = await imp(root, "lib/apps.ts");
const { grantCatalog } = await imp(root, "lib/grants.ts");
const { NextRequest } = await import("next/server");

// The old /api/auth/redirect decision, copied verbatim from app/api/auth/redirect/route.ts at the pre-M2 commit.
async function oldRedirectAllowed(app, appId, discordId, user, dbUser, isAdmin) {
  const accessRows = await real.appAccess.findMany({ where: { userId: dbUser.id, appId, granted: true } });
  return app.allowedDiscordId
    ? discordId === app.allowedDiscordId && accessRows.length > 0
    : appId === oldCases.CASES_DASHBOARD_APP_ID
    ? oldCases.isCasesDashboardAllowed(user)
    : appId === oldFront.FRONTWIND_DUBBING_APP_ID
      ? accessRows.length > 0 && oldFront.isFrontwindDubbingAllowed(user)
      : appId === "renderfarm"
        ? (await oldAccess.permittedAppIds({ id: dbUser.id, isAdmin }, user)).includes(appId)
      : app.requireExplicitGrant
        ? accessRows.length > 0
        : app.allowAnyAuthenticatedUser || isAdmin || accessRows.length > 0;
}

const owner = process.env.ADMIN_DISCORD_ID;
const users = await real.user.findMany({ orderBy: { createdAt: "asc" }, select: { id: true, discordId: true, username: true, avatar: true, email: true, isAdmin: true } });
const redirectApps = [...allApps.map((a) => a.id), "video-review-guest"];
const diffs = [];
const counts = { users: users.length, meCompared: 0, permittedCompared: 0, redirectCompared: 0, checkCompared: 0, tabCompared: 0 };
const tabHolders = Object.fromEntries(grantCatalog.filter((g) => g.kind === "tab").map((g) => [g.id, []]));
let unknownAllowed = 0;

for (const u of users) {
  const user = { discordId: u.discordId, username: u.username, avatar: u.avatar, email: u.email, isAdmin: u.discordId === owner, emailVerified: false };
  globalThis.__m2.session = { user };
  const a = await (await oldMe()).json();
  const b = await (await newMe()).json();
  counts.meCompared++;
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    for (const k of new Set([...Object.keys(a.access ?? {}), ...Object.keys(b.access ?? {})])) {
      if (a.access?.[k] !== b.access?.[k]) diffs.push(`${u.username} /api/me ${k}: ${a.access?.[k]} -> ${b.access?.[k]}`);
    }
    if (a.isAdmin !== b.isAdmin || a.discordId !== b.discordId) diffs.push(`${u.username} /api/me header differs`);
    if (a.error || b.error) diffs.push(`${u.username} /api/me error old=${a.error} new=${b.error}`);
  }

  const isAdmin = u.isAdmin || u.discordId === owner;
  const pa = (await oldAccess.permittedAppIds({ id: u.id, isAdmin }, user)).join(",");
  const pb = (await newAccess.permittedAppIds({ id: u.id, isAdmin }, user)).join(",");
  counts.permittedCompared++;
  if (pa !== pb) diffs.push(`${u.username} permittedAppIds: ${pa} -> ${pb}`);

  const granted = await newAccess.grantedIds(u.id);
  for (const appId of redirectApps) {
    const ra = await oldRedirectAllowed(oldApps.getAppById(appId), appId, u.discordId, user, u, isAdmin);
    const rb = newAccess.handoffAllowed(getAppById(appId), { discordId: u.discordId, user, isAdmin, granted });
    counts.redirectCompared++;
    if (Boolean(ra) !== Boolean(rb)) diffs.push(`${u.username} redirect ${appId}: ${ra} -> ${rb}`);
  }

  // M4 (27 Nov 2026): tab grants under the rule before the Pulse shell change (owner, or the tab row AND the parent
  // app usable), copied verbatim, against the new grantAllowed.
  const ctx = { discordId: u.discordId, user, isAdmin, granted };
  for (const t of grantCatalog.filter((g) => g.kind === "tab")) {
    const before = newAccess.isOwner(u.discordId) || (granted.has(t.id) && newAccess.grantAllowed(t.app, ctx));
    counts.tabCompared++;
    if (before !== newAccess.grantAllowed(t.id, ctx)) diffs.push(`${u.username} tab ${t.id}: ${before} -> ${!before}`);
  }

  for (const g of [...grantCatalog.map((g) => g.id), "nope.unknown", "pulse.hiring.extra", ""]) {
    const res = await newCheck(new NextRequest(`http://127.0.0.1:3900/api/access/check?grant=${encodeURIComponent(g)}`));
    const { allowed } = await res.json();
    const def = grantCatalog.find((x) => x.id === g);
    if (!def) { if (allowed !== false) { unknownAllowed++; diffs.push(`${u.username} check ${g || "(empty)"}: allowed for an unknown grant`); } continue; }
    if (def.kind === "app") {
      counts.checkCompared++;
      if (allowed !== b.access[g]) diffs.push(`${u.username} check ${g}: ${allowed} but /api/me says ${b.access[g]}`);
    } else if (allowed) tabHolders[g].push(u.username);
  }
}

console.log(`m2 mirror ${new Date().toISOString()}  old=${path.basename(oldRoot)}`);
console.log(`users ${counts.users}; /api/me maps compared ${counts.meCompared} (x ${allApps.length} apps); permittedAppIds ${counts.permittedCompared}; redirect decisions ${counts.redirectCompared}; check-vs-me app answers ${counts.checkCompared}; tab rule old-vs-new ${counts.tabCompared}`);
console.log(`writes attempted by the routes (blocked): ${writes.length}${writes.length ? " " + [...new Set(writes)].join(",") : ""}`);
console.log(`unknown grants allowed: ${unknownAllowed}`);
for (const [g, who] of Object.entries(tabHolders)) console.log(`tab ${g}: ${who.length} allowed (${who.join(", ") || "nobody"})`);
console.log(`DIFFERENCES: ${diffs.length}`);
for (const d of diffs) console.log(`  ${d}`);
await real.$disconnect();
process.exit(diffs.length || writes.length ? 1 : 0);
