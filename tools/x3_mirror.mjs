#!/usr/bin/env node
// DEV ONLY (X3, R-3258): who gains or loses what between the live code and this release, for every person in portal_dev.
//
//   cd /opt/access-dev/portal && node --experimental-strip-types --no-warnings tools/x3_mirror.mjs <old-checkout> \
//        [--non-members user1,user2,...] [--unknown user3,...]
//
// Runs the REAL /api/me and /api/auth/redirect routes of both checkouts in-process, per person and per app, with the
// session faked and the database read only (every write is blocked and counted). Discord is stubbed: everyone is a
// server member with a team role, except --non-members (404 code 10007) and --unknown (500); non-Discord ids are
// never asked (as in lib/teamRule.ts). Default --non-members = the 6 accounts the 27 Nov read-only server check found
// (plan-training e3-signin-dryrun.md). Also compares who may change access: old = any Portal admin (the old /admin
// PATCH), new = owner + access admins (lib/accessChanges.ts). B0 test users (lib/testUsers.ts) are listed apart and
// not counted. Refuses unless DATABASE_URL names portal_dev. Prints usernames only (no emails, ids or env values).
import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
import { pathToFileURL, fileURLToPath } from "node:url";
import path from "node:path";
import dotenv from "dotenv";
import pg from "pg";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const oldRoot = path.resolve(args[0] ?? "");
const list = (name, def) => (args.includes(name) ? args[args.indexOf(name) + 1] : def).split(",").map((s) => s.trim()).filter(Boolean);
dotenv.config({ path: path.join(root, ".env"), quiet: true });
if (!/\/portal_dev(\?|$)/.test(process.env.DATABASE_URL ?? "")) { console.error("x3_mirror: refused: DATABASE_URL is not portal_dev"); process.exit(2); }
if (!existsSync(path.join(oldRoot, "app/api/auth/redirect/route.ts")) || oldRoot === root) { console.error("usage: x3_mirror.mjs <old-checkout-dir>"); process.exit(1); }
const nonMemberNames = new Set(list("--non-members", "bigtiz1396,amino1473,ldlyoussef6828,projecta040,chigolarry,yayamadi2202"));
const unknownNames = new Set(list("--unknown", ""));

const fakes = {
  "@/auth": "export const auth = async () => globalThis.__x3.session;",
  "@/lib/db": "export const prisma = new Proxy({}, { get: (_, k) => globalThis.__x3.prisma[k] });",
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
const READS = new Set(["findMany", "findUnique", "findFirst", "count", "groupBy"]);
function readOnlyModel(name) {
  return new Proxy({}, {
    get(_, op) {
      if (READS.has(op)) return (...a) => real[name][op](...a);
      if (name === "user" && op === "upsert") {
        return async ({ where, include }) => {
          const u = await real.user.findUnique({ where, include });
          if (!u) throw new Error("x3_mirror: user vanished");
          return u;
        };
      }
      return async () => { writes.push(`${name}.${String(op)}`); return op.endsWith("Many") ? { count: 0 } : null; };
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
globalThis.__x3 = { session: null, prisma: ro };

const users = await real.user.findMany({ orderBy: { createdAt: "asc" }, select: { id: true, discordId: true, username: true, avatar: true, email: true, isAdmin: true, isAccessAdmin: true } });
const idOf = new Map(users.map((u) => [u.discordId, u.username]));
// Discord stub (both checkouts call fetch the same way; only the new one asks for learn)
process.env.DISCORD_TEAM_BOT_TOKEN = "x3-mirror-stub";
delete process.env.DISCORD_API_BASE;
const discordCalls = { member: 0, nonMember: 0, unknown: 0 };
globalThis.fetch = async (url) => {
  const id = String(url).match(/\/members\/(\d+)$/)?.[1];
  const name = idOf.get(id ?? "");
  if (unknownNames.has(name)) { discordCalls.unknown++; return new Response("{}", { status: 500 }); }
  if (nonMemberNames.has(name)) { discordCalls.nonMember++; return new Response(JSON.stringify({ code: 10007 }), { status: 404 }); }
  discordCalls.member++;
  return new Response(JSON.stringify({ roles: ["1536130288504152206"], user: { username: name ?? "x" } }), { status: 200 });
};

const imp = (dir, f) => import(pathToFileURL(path.join(dir, f)).href);
const oldMe = (await imp(oldRoot, "app/api/me/route.ts")).GET;
const oldRedirect = (await imp(oldRoot, "app/api/auth/redirect/route.ts")).GET;
const oldApps = await imp(oldRoot, "lib/apps.ts");
const newMe = (await imp(root, "app/api/me/route.ts")).GET;
const newRedirect = (await imp(root, "app/api/auth/redirect/route.ts")).GET;
const newApps = await imp(root, "lib/apps.ts");
const C = await imp(root, "lib/accessChanges.ts");
const { isTestUser } = await imp(root, "lib/testUsers.ts");
const { NextRequest } = await import("next/server");

const appIds = [...new Set([...oldApps.allApps.map((a) => a.id), ...newApps.allApps.map((a) => a.id), "video-review-guest"])];
function outcome(res, appId) {
  const loc = res.headers.get("location") ?? "";
  if (res.status === 302) {
    const app = newApps.getAppById(appId) ?? oldApps.getAppById(appId);
    try { if (app && new URL(loc).host === new URL(app.url).host) return "open"; } catch { /* fall through */ }
    return loc.includes("/login") ? "login" : `302 elsewhere`;
  }
  if (res.status === 404) return "no such app";
  if (res.status === 403) return "refused";
  if (res.status === 503) return "try again / not switched on";
  return `HTTP ${res.status}`;
}

const owner = process.env.ADMIN_DISCORD_ID;
const diffs = [];
const counts = { people: 0, testUsers: [], meCompared: 0, redirectCompared: 0 };
for (const u of users) {
  if (isTestUser(u)) { counts.testUsers.push(u.username); continue; }
  counts.people++;
  const user = { discordId: u.discordId, username: u.username, avatar: u.avatar, email: u.email, isAdmin: u.discordId === owner, emailVerified: false };
  globalThis.__x3.session = { user };
  const a = await (await oldMe()).json();
  const b = await (await newMe()).json();
  counts.meCompared++;
  for (const k of new Set([...Object.keys(a.access ?? {}), ...Object.keys(b.access ?? {})])) {
    if (a.access?.[k] !== b.access?.[k]) diffs.push({ who: u.username, what: `/api/me ${k}`, from: String(a.access?.[k]), to: String(b.access?.[k]) });
  }
  if (a.isAdmin !== b.isAdmin) diffs.push({ who: u.username, what: "/api/me isAdmin", from: String(a.isAdmin), to: String(b.isAdmin) });
  for (const appId of appIds) {
    const req = () => new NextRequest(`http://127.0.0.1:3900/api/auth/redirect?app=${encodeURIComponent(appId)}`);
    const ra = outcome(await oldRedirect(req()), appId);
    const rb = outcome(await newRedirect(req()), appId);
    counts.redirectCompared++;
    if (ra !== rb) diffs.push({ who: u.username, what: `redirect ${appId}`, from: ra, to: rb });
  }
  const oldCan = u.isAdmin || u.discordId === owner;                                   // old /admin PATCH: any Portal admin
  const newCan = await C.canManageAccess({ discordId: u.discordId, username: u.username });
  if (oldCan !== newCan) diffs.push({ who: u.username, what: "may change access", from: String(oldCan), to: String(newCan) });
}

console.log(`x3 mirror ${new Date().toISOString()}  old=${path.basename(oldRoot)}`);
console.log(`people ${counts.people} (test users not counted: ${counts.testUsers.length}${counts.testUsers.length ? " " + counts.testUsers.join(", ") : ""}); /api/me compared ${counts.meCompared}; redirect decisions ${counts.redirectCompared} (${appIds.length} apps each)`);
console.log(`discord stub answers: member ${discordCalls.member}, not a member ${discordCalls.nonMember}, error ${discordCalls.unknown}`);
console.log(`writes attempted by the routes (blocked): ${writes.length}${writes.length ? " " + [...new Set(writes)].join(",") : ""}`);
console.log(`DIFFERENCES: ${diffs.length}`);
const byWhat = new Map();
for (const d of diffs) {
  const k = `${d.what}: ${d.from} -> ${d.to}`;
  byWhat.set(k, [...(byWhat.get(k) ?? []), d.who]);
}
for (const [k, who] of [...byWhat].sort()) console.log(`  ${k}  (${who.length}) ${who.join(", ")}`);
await real.$disconnect();
process.exit(0);
