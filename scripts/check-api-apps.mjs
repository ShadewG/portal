// Check for GET /api/apps (plan 3.11). Runs the real route, lib/apps.ts and lib/access.ts in plain
// Node with the session and the database faked in-process: no network, no real database, no secrets.
// The access map is compared with what the existing /api/me route answers for the same people.
//
//   node --experimental-strip-types --no-warnings scripts/check-api-apps.mjs
import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
import { pathToFileURL, fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fakes = {
  "@/auth": "export const auth = async () => globalThis.__check.session;",
  "@/lib/db": "export const prisma = new Proxy({}, { get: (_, k) => globalThis.__check.prisma[k] });",
};
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (fakes[specifier]) return { url: `data:text/javascript,${encodeURIComponent(fakes[specifier])}`, shortCircuit: true };
    if (specifier.startsWith("@/")) {
      const base = path.join(root, specifier.slice(2));
      const file = [".ts", ".tsx"].map((ext) => base + ext).find(existsSync);
      return { url: pathToFileURL(file).href, shortCircuit: true };
    }
    // next-auth style bare "next/server" imports only resolve in a bundler.
    return nextResolve(/^next\/[a-z-]+$/.test(specifier) ? `${specifier}.js` : specifier, context);
  },
});

process.env.AUTH_URL = "http://localhost:3002";
process.env.ADMIN_DISCORD_ID = "900000000000000001";

// In-memory stand-in for the three tables the two routes read.
const db = { users: [], grants: [], fail: false, nextId: 1 };
const guard = () => { if (db.fail) throw new Error("check: database down"); };
const withAccess = (u) => ({ ...u, access: db.grants.filter((g) => g.userId === u.id) });
globalThis.__check = {
  session: null,
  prisma: {
    user: {
      async findUnique({ where }) { guard(); return db.users.find((u) => u.discordId === where.discordId) ?? null; },
      async upsert({ where, update, create }) {
        guard();
        let u = db.users.find((x) => x.discordId === where.discordId);
        if (u) Object.assign(u, update);
        else db.users.push((u = { id: `user${db.nextId++}`, ...create }));
        return withAccess(u);
      },
    },
    appAccess: {
      // /api/me asks for the person's Desk row (lib/teamAccess.ts, 2 Nov 2026); no bot token here, so Discord is never asked
      async findUnique({ where }) { guard(); return db.grants.find((g) => g.userId === where.userId_appId.userId && g.appId === where.userId_appId.appId) ?? null; },
      async findMany({ where }) {
        guard();
        return db.grants.filter((g) => g.userId === where.userId && (where.appId === undefined || g.appId === where.appId) && (where.granted === undefined || g.granted === where.granted));
      },
    },
    pendingAppAccess: { async findMany() { guard(); return []; } },
    async $transaction(ops) { return Promise.all(ops); },
  },
};

const { GET: appsGET } = await import(pathToFileURL(path.join(root, "app/api/apps/route.ts")).href);
const { GET: meGET } = await import(pathToFileURL(path.join(root, "app/api/me/route.ts")).href);
const { allApps } = await import(pathToFileURL(path.join(root, "lib/apps.ts")).href);
const { NextRequest } = await import("next/server");

const results = [];
const check = (name, ok, detail = "") => results.push({ name, ok: Boolean(ok), detail });
const req = (headers = {}) => new NextRequest("http://localhost:3002/api/apps", { headers });
const signIn = (discordId, username) => { globalThis.__check.session = discordId ? { user: { discordId, username } } : null; };
function seed(discordId, isAdmin, appIds) {
  const u = { id: `user${db.nextId++}`, discordId, username: "seed", avatar: null, email: null, isAdmin };
  db.users.push(u);
  for (const appId of appIds) db.grants.push({ userId: u.id, appId, granted: true });
  db.grants.push({ userId: u.id, appId: "autobot", granted: false }); // a revoked row must not count
}

// 1. Signed out.
signIn(null);
let res = await appsGET(req());
check("signed out -> 401", res.status === 401, `status ${res.status}`);

// 2. People, each compared with /api/me (apps first: /api/me upserts).
const people = [
  { label: "editor with desk, foia-sorter, script-reviewer", id: "900000000000000010", username: "check-editor", seed: [false, ["desk", "foia-sorter", "script-reviewer"]], expect: { desk: true, "foia-sorter": true, "insanity-courses": true, pulse: false, autobot: false, "ayoub-private-assistant": false, renderfarm: true } },
  { label: "Portal admin, no grants", id: "900000000000000011", username: "check-admin", seed: [true, []], expect: { autobot: true, "script-reviewer": true, desk: false, pulse: false, renderfarm: true, "ayoub-private-assistant": false } },
  { label: "owner of the personal app (Ayoub's id)", id: "1033050881798709378", username: "ayoub_prods", seed: [false, ["ayoub-private-assistant", "desk"]], expect: { "ayoub-private-assistant": true, "cases-dashboard": true, desk: true } },
  { label: "admin on the cases and dubbing lists (shadew_)", id: "214430154527735808", username: "shadew_", seed: [true, ["frontwind-dubbing", "renderfarm", "pulse", "desk"]], expect: { "frontwind-dubbing": true, "cases-dashboard": true, renderfarm: true, pulse: true, "ayoub-private-assistant": false } },
  { label: "ADMIN_DISCORD_ID, no Portal row yet", id: "900000000000000001", username: "check-env-admin", seed: null, expect: { autobot: true, desk: false }, admin: true },
  { label: "brand-new person, no Portal row", id: "900000000000000012", username: "check-new", seed: null, expect: { "insanity-courses": true, desk: false, autobot: false } },
  // Render Farm (15 Oct 2026): the team sees it; guests (a pilot only) and Autobot-only accounts do not.
  { label: "Patreon pilot guest only", id: "900000000000000013", username: "check-guest", seed: [false, ["patreon"]], expect: { patreon: true, renderfarm: false, desk: false } },
  { label: "Autobot only (ProjectA-style)", id: "900000000000000014", username: "check-autobot", seed: [false, ["autobot"]], expect: { autobot: true, renderfarm: false } },
  { label: "renderfarm grant only", id: "900000000000000015", username: "check-rf", seed: [false, ["renderfarm"]], expect: { renderfarm: true, desk: false } },
];
for (const p of people) {
  if (p.seed) seed(p.id, ...p.seed);
  signIn(p.id, p.username);
  const rowsBefore = db.users.length;
  res = await appsGET(req());
  const body = await res.json();
  const readOnly = db.users.length === rowsBefore;
  const access = Object.fromEntries(body.apps.map((a) => [a.id, a.access]));
  const me = await (await meGET()).json();
  const diff = allApps.map((a) => a.id).filter((id) => access[id] !== me.access[id]);
  const wrong = Object.entries(p.expect).filter(([id, want]) => access[id] !== want).map(([id]) => id);
  const adminOk = p.admin === undefined || body.user.isAdmin === p.admin;
  check(`${p.label}: same access as /api/me, expected flags, no write`, res.status === 200 && diff.length === 0 && wrong.length === 0 && readOnly && adminOk,
    `status ${res.status}, differs from /api/me: [${diff}], unexpected: [${wrong}], read-only: ${readOnly}, granted ${Object.values(access).filter(Boolean).length}/${allApps.length}`);
}

// 3. Shape: whole catalog, absolute open links, nothing private.
signIn("900000000000000010", "check-editor");
res = await appsGET(req({ "x-forwarded-proto": "https", "x-forwarded-host": "portal.insanity.team" }));
let body = await res.json();
const text = JSON.stringify(body);
const desk = body.apps.find((a) => a.id === "desk");
check("lists every catalog app once", body.apps.length === allApps.length && new Set(body.apps.map((a) => a.id)).size === allApps.length, `${body.apps.length} apps`);
check("openUrl behind Caddy", desk.openUrl === "https://portal.insanity.team/api/auth/redirect?app=desk", desk.openUrl);
check("origin is the app's own address", desk.origin === "https://desk.insanity.team" && body.apps.find((a) => a.id === "foia-sorter").origin === "https://foiasorter.insanity.team");
check("no allowedDiscordId or allow-list ids in the body", !text.includes("allowedDiscordId") && !text.includes("1033050881798709378"));
check("not cacheable", res.headers.get("cache-control") === "private, no-store", res.headers.get("cache-control"));
res = await appsGET(req());
body = await res.json();
check("openUrl falls back to AUTH_URL", body.apps[0].openUrl.startsWith("http://localhost:3002/api/auth/redirect?app="), body.apps[0].openUrl);

// 4. Database down.
db.fail = true;
const { error } = console;
console.error = () => {};
res = await appsGET(req());
console.error = error;
check("database error -> 503 JSON", res.status === 503 && (await res.json()).error, `status ${res.status}`);

let failed = 0;
for (const r of results) {
  if (!r.ok) failed++;
  console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}${r.detail ? `  (${r.detail})` : ""}`);
}
process.exit(failed ? 1 : 0);
