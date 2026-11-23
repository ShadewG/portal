// Check for the Desk team rule at Portal's handoff (lib/teamAccess.ts, 2 Nov 2026). Runs the real
// /api/auth/redirect route and lib/teamAccess.ts in plain Node with the session, the database and Discord faked
// in-process: no network, no real database, no secrets.
//
//   node --experimental-strip-types --no-warnings scripts/check-team-desk-handoff.mjs
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
    return nextResolve(/^next\/[a-z-]+$/.test(specifier) ? `${specifier}.js` : specifier, context);
  },
});

process.env.AUTH_URL = "http://localhost:3002";
process.env.ADMIN_DISCORD_ID = "900000000000000001";
process.env.PORTAL_JWT_SECRET = "check-secret";
process.env.DISCORD_TEAM_BOT_TOKEN = "check-bot-token";

const db = { users: [], grants: [], nextId: 1 };
globalThis.__check = {
  session: null,
  prisma: {
    user: {
      async upsert({ where, update, create }) {
        let u = db.users.find((x) => x.discordId === where.discordId);
        if (u) Object.assign(u, update); else db.users.push((u = { id: `user${db.nextId++}`, ...create }));
        return u;
      },
    },
    appAccess: {
      async findUnique({ where }) { return db.grants.find((g) => g.userId === where.userId_appId.userId && g.appId === where.userId_appId.appId) ?? null; },
      async findMany({ where }) { return db.grants.filter((g) => g.userId === where.userId && (where.appId === undefined || g.appId === where.appId) && (where.granted === undefined || g.granted === where.granted)); },
      async create({ data }) { const g = { id: `g${db.nextId++}`, ...data }; db.grants.push(g); return g; },
      async updateMany({ where, data }) { const rows = db.grants.filter((g) => g.id === where.id && g.grantedBy === where.grantedBy); rows.forEach((g) => Object.assign(g, data)); return { count: rows.length }; },
    },
    pendingAppAccess: { async findMany() { return []; } },
    appUserLink: { async findUnique() { return null; } },
    async $transaction(ops) { return Promise.all(ops); },
  },
};

// Discord: who is on the server, with which roles. A missing person is Discord's "Unknown Member" (10007).
const JUNIOR = "1275562167269068800", DUBBERS = "1365331973576458241";
const guild = new Map();
let discordCalls = 0, discordDown = false;
globalThis.fetch = async (url) => {
  const m = String(url).match(/^https:\/\/discord\.com\/api\/v10\/guilds\/1275557298307203123\/members\/(\d+)$/);
  if (!m) throw new Error(`check: unexpected network call ${url}`);
  discordCalls++;
  if (discordDown) return new Response("{}", { status: 503 });
  const member = guild.get(m[1]);
  return member ? new Response(JSON.stringify(member), { status: 200 }) : new Response(JSON.stringify({ message: "Unknown Member", code: 10007 }), { status: 404 });
};

const { GET: handoffGET } = await import(pathToFileURL(path.join(root, "app/api/auth/redirect/route.ts")).href);
const { NextRequest } = await import("next/server");
const jwt = (await import("jsonwebtoken")).default;
const CADDY = { "x-forwarded-proto": "https", "x-forwarded-host": "portal.insanity.team" };
const results = [];
const check = (name, ok, detail = "") => results.push({ name, ok: Boolean(ok), detail });
const as = (discordId, username) => { globalThis.__check.session = { user: { discordId, username } }; };
const handoff = (app = "desk") => handoffGET(new NextRequest(`https://0.0.0.0:3002/api/auth/redirect?app=${app}`, { headers: CADDY }));
const tokenOf = (res) => { const u = new URL(res.headers.get("location") ?? "http://x/"); const t = u.searchParams.get("portal_token"); return t ? jwt.verify(t, "check-secret") : null; };
const deskRow = (discordId) => { const u = db.users.find((x) => x.discordId === discordId); return db.grants.find((g) => g.userId === u?.id && g.appId === "desk") ?? null; };
let n = 0;
const fresh = () => String(200000000000000000n + BigInt(++n));   // a new person each time: the five-minute memory never carries over

// 1. a newcomer on the team: granted on the way in, sent to Desk with their server name
const kea = fresh();
guild.set(kea, { roles: [JUNIOR], nick: "Kea", user: { username: "k3aloha", avatar: "a_0123456789abcdef0123456789abcdef" } });
as(kea, "k3aloha");
let res = await handoff();
let row = deskRow(kea);
check("team newcomer -> Desk grant made by the rule", row?.granted === true && row?.grantedBy === "auto:discord-team", JSON.stringify(row));
check("team newcomer -> handed to Desk", res.status === 302 && (res.headers.get("location") ?? "").startsWith("https://desk.insanity.team/auth/portal?"), `${res.status}`);
const claims = tokenOf(res);
check("the token carries their current Discord picture", claims?.avatar === "a_0123456789abcdef0123456789abcdef", String(claims?.avatar));
check("the token names them as the server does", claims?.name === "Kea" && claims?.appId === "desk" && Array.isArray(claims?.apps) && claims.apps.includes("desk"), JSON.stringify(claims && { name: claims.name, apps: claims.apps }));

// 2. not on the team: no grant, a plain page that says so
const guest = fresh();
guild.set(guest, { roles: [DUBBERS], user: { username: "guest" } });
as(guest, "guest<script>");
res = await handoff();
let body = await res.text();
check("non-team account -> 403 page, no grant", res.status === 403 && deskRow(guest) === null, `${res.status}`);
check("the page says it is for the team and offers a way on", body.includes("Desk is for the Insanity team") && body.includes("Use a different Discord account") && body.includes("https://portal.insanity.team/api/auth/redirect?app=desk"), body.slice(0, 80));
check("the username is escaped", body.includes("guest&lt;script&gt;") && !body.includes("guest<script>"));
const stranger = fresh();
as(stranger, "stranger");
res = await handoff();
check("not on the server at all -> the same page", res.status === 403 && deskRow(stranger) === null && (await res.text()).includes("This account doesn't have one"));

// 3. leaves the team: the rule's own grant is turned off at the next pass, and Desk is refused
const leaver = fresh();
guild.set(leaver, { roles: [JUNIOR], user: { username: "leaver" } });
as(leaver, "leaver");
await handoff();
guild.set(leaver, { roles: [DUBBERS], user: { username: "leaver" } });
// (a different Portal instance or five minutes later: the memory is per process; wait it out by asking as a new process would)
const { teamMember } = await import(pathToFileURL(path.join(root, "lib/teamRule.ts")).href);
await teamMember(leaver, globalThis.fetch, Date.now() + 6 * 60_000);   // refresh the cached answer
res = await handoff();
row = deskRow(leaver);
check("role taken away -> grant off, Desk refused", res.status === 403 && row?.granted === false && row?.grantedBy === "auto:discord-team", `${res.status} ${JSON.stringify(row)}`);
guild.set(leaver, { roles: [JUNIOR], user: { username: "leaver" } });
await teamMember(leaver, globalThis.fetch, Date.now() + 12 * 60_000);
res = await handoff();
check("role given back -> in again", res.status === 302 && deskRow(leaver)?.granted === true);

// 4. an admin's own decisions stand
const george = fresh();
as(george, "editorezy");
await handoff();   // creates the user
const gUser = db.users.find((u) => u.discordId === george);
db.grants.push({ id: "manual-george", userId: gUser.id, appId: "desk", granted: true, grantedBy: "214430154527735808" });
res = await handoff();
check("hand-granted, not on the server -> untouched, still in", res.status === 302 && deskRow(george).granted === true && deskRow(george).grantedBy === "214430154527735808");
const blocked = fresh();
guild.set(blocked, { roles: [JUNIOR], user: { username: "blocked" } });
as(blocked, "blocked");
await handoff();
const bUser = db.users.find((u) => u.discordId === blocked);
Object.assign(deskRow(blocked), { granted: false, grantedBy: "214430154527735808" });   // an admin unticked them in /admin
res = await handoff();
check("unticked by an admin, on the team -> stays out", res.status === 403 && deskRow(blocked).granted === false && bUser);

// 5. Discord unreachable: nobody's access changes
const steady = fresh();
guild.set(steady, { roles: [JUNIOR], user: { username: "steady" } });
as(steady, "steady");
await handoff();
discordDown = true;
await teamMember(steady, globalThis.fetch, Date.now() + 6 * 60_000);
res = await handoff();
check("Discord down, granted -> still in", res.status === 302 && deskRow(steady).granted === true);
const waiting = fresh();
as(waiting, "waiting");
res = await handoff();
body = await res.text();
check("Discord down, newcomer -> try-again page, no grant", res.status === 403 && deskRow(waiting) === null && body.includes("couldn't check"));
discordDown = false;

// 6. other apps never ask Discord and never get a grant from this rule
const before = discordCalls, grantsBefore = db.grants.length;
as(kea, "k3aloha");
res = await handoffGET(new NextRequest("https://0.0.0.0:3002/api/auth/redirect?app=pulse", { headers: CADDY }));
check("another app -> Discord not asked, no grant made", discordCalls === before && db.grants.length === grantsBefore && res.status === 403);

const failed = results.filter((r) => !r.ok);
for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}${r.detail && !r.ok ? `  (${r.detail})` : ""}`);
console.log(`${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
