// Check for Render Farm access (15 Oct 2026): the team may view, only admins + the `renderfarm` grant
// may control. Runs the real routes and lib/renderfarm.ts in plain Node with the session and the
// database faked in-process. RENDER_FARM_TOKEN is empty, so a request that gets past the access
// check is answered 503 "not configured" by lib/renderfarm.ts itself: the real farm is never called.
//
//   node --experimental-strip-types --no-warnings scripts/check-renderfarm-access.mjs
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

process.env.ADMIN_DISCORD_ID = "900000000000000001";
process.env.RENDER_FARM_TOKEN = "";
process.env.RENDER_FARM_MEDIA_CACHE = "/nonexistent-renderfarm-check";

const users = [], grants = [];
const person = (discordId, username, isAdmin, appIds, revoked = []) => {
  const u = { id: `user-${discordId}`, discordId, username, email: null, isAdmin };
  users.push(u);
  for (const appId of appIds) grants.push({ userId: u.id, appId, granted: true });
  for (const appId of revoked) grants.push({ userId: u.id, appId, granted: false });
};
globalThis.__check = {
  session: null,
  prisma: {
    user: {
      async findUnique({ where }) { return users.find((u) => u.discordId === where.discordId) ?? null; },
      async findFirst({ where }) {
        return users.find((u) => where.OR.some((c) => (c.discordId && u.discordId === c.discordId) || (c.email && u.email === c.email) || (c.username && u.username === c.username))) ?? null;
      },
    },
    appAccess: {
      async findMany({ where }) { return grants.filter((g) => g.userId === where.userId && (where.granted === undefined || g.granted === where.granted)); },
    },
  },
};

const route = (p) => import(pathToFileURL(path.join(root, p)).href);
const { renderFarmAccess } = await route("lib/renderfarm.ts");
const { POST: controlPOST } = await route("app/api/renderfarm/control/route.ts");
const { POST: requeuePOST } = await route("app/api/renderfarm/requeue/route.ts");
const { GET: liveGET } = await route("app/api/renderfarm/live/route.ts");
const { GET: posterGET } = await route("app/api/renderfarm/poster/route.ts");

person("900000000000000020", "check-editor", false, ["foia-sorter", "desk"]);
person("900000000000000021", "check-controller", false, ["renderfarm"]);
person("900000000000000022", "check-admin", true, []);
person("900000000000000023", "check-guest", false, ["patreon"]);
person("900000000000000024", "check-autobot", false, ["autobot"]);
person("900000000000000025", "check-revoked", false, [], ["foia-sorter", "renderfarm"]);
person("900000000000000026", "check-nothing", false, []);

const results = [];
const check = (name, ok, detail = "") => results.push({ name, ok: Boolean(ok), detail });
const signIn = (discordId, username) => { globalThis.__check.session = discordId ? { user: { discordId, username } } : null; };
const post = (url, body) => new Request(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const PAGE = "3f187c20-070a-80d8-8112-eaf273406c3a";

const cases = [
  { who: "signed out", id: null, view: false, control: false },
  { who: "team member (FOIA Sorter + Desk)", id: "900000000000000020", name: "check-editor", view: true, control: false },
  { who: "renderfarm grant", id: "900000000000000021", name: "check-controller", view: true, control: true },
  { who: "Portal admin, no grants", id: "900000000000000022", name: "check-admin", view: true, control: true },
  { who: "ADMIN_DISCORD_ID, no Portal row", id: "900000000000000001", name: "check-env-admin", view: true, control: true },
  { who: "Patreon pilot guest", id: "900000000000000023", name: "check-guest", view: false, control: false },
  { who: "Autobot only", id: "900000000000000024", name: "check-autobot", view: false, control: false },
  { who: "revoked rows only", id: "900000000000000025", name: "check-revoked", view: false, control: false },
  { who: "signed in, nothing approved", id: "900000000000000026", name: "check-nothing", view: false, control: false },
  { who: "unknown Discord id", id: "900000000000000099", name: "check-unknown", view: false, control: false },
];
for (const c of cases) {
  signIn(c.id, c.name);
  const a = await renderFarmAccess(globalThis.__check.session);
  check(`${c.who}: access view=${c.view} control=${c.control}`, a.view === c.view && a.control === c.control, JSON.stringify(a));
  // Past the gate = 503 from the unconfigured farm client; refused = 403.
  const gate = (ok) => (ok ? 503 : 403);
  const live = await liveGET();
  check(`${c.who}: GET live -> ${gate(c.view)}`, live.status === gate(c.view), `status ${live.status}`);
  const poster = await posterGET(new Request("http://localhost/api/renderfarm/poster?path=/etc/passwd"));
  check(`${c.who}: GET poster -> ${c.view ? 404 : 403}`, poster.status === (c.view ? 404 : 403), `status ${poster.status}`);
  const ctl = await controlPOST(post("http://localhost/api/renderfarm/control", { action: "Pause" }));
  check(`${c.who}: POST control -> ${gate(c.control)}`, ctl.status === gate(c.control), `status ${ctl.status}`);
  const rq = await requeuePOST(post("http://localhost/api/renderfarm/requeue", { pageId: PAGE, kind: "texted" }));
  check(`${c.who}: POST requeue -> ${gate(c.control)}`, rq.status === gate(c.control), `status ${rq.status}`);
}

let failed = 0;
for (const r of results) {
  if (!r.ok) failed++;
  console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}${r.detail ? `  (${r.detail})` : ""}`);
}
console.log(`${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
