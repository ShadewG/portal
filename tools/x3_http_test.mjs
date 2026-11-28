#!/usr/bin/env node
// DEV ONLY (X3, R-3258): the X3 release over HTTP on the test copy (127.0.0.1:3900, portal_dev), after tools/x3_seed.mjs
// and tools/test_users.mjs create. Needs the Discord stub (tools/x3_discord_stub.mjs) and the service started with
// DISCORD_TEAM_BOT_TOKEN=<anything> DISCORD_API_BASE=http://127.0.0.1:3911 (the stub decides who is on the server).
//   cd /opt/access-dev/portal && sudo -u accessdev node tools/x3_http_test.mjs
// Roles: owner shadew_; access admins ayoub_prods (also Portal admin) and atomboy7 (not a Portal admin); read-only
// Portal admin hareld; plain member wisedumdum; non-member chigolarry; Discord error yovcheff. (stub answers 500);
// non-Discord id InsanityBot demo-tutorial; B0 test users (minted sessions). Ends with a fingerprint of AppAccess +
// User flags + PendingAppAccess equal to the start (every change made here is undone).
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import pg from "pg";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: path.join(root, ".env"), quiet: true });
if (!/\/portal_dev(\?|$)/.test(process.env.DATABASE_URL ?? "")) { console.error("refused: DATABASE_URL is not portal_dev"); process.exit(2); }
const B = process.env.PORTAL_BASE ?? "http://127.0.0.1:3900"; // X6: the merged copy runs on :3906
const SESS = process.env.X3_SESSIONS ?? "/opt/access-dev/x3/sessions";
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const Q = async (sql, args = []) => (await db.query(sql, args)).rows;
const results = [];
const check = (name, ok, detail = "") => { results.push(!!ok); console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? "  " + detail : ""}`); };
const node = (f, a) => execFileSync("node", ["--experimental-strip-types", "--no-warnings", path.join(root, f), ...a], { cwd: root, encoding: "utf8" }).trim();
const cookie = (who) => node("tools/dev_login.mjs", [who]);
function minted(role) {
  const line = readFileSync(path.join(SESS, `${role}.cookie`), "utf8").split("\n").find((l) => l && !l.startsWith("#"));
  const f = line.split("\t");
  return `${f[5]}=${f[6]}`;
}
async function call(c, method, url, body) {
  const write = method !== "GET";
  const headers = { ...(c ? { Cookie: c } : {}), ...(write ? { Origin: B, "Content-Type": "application/json" } : {}) };
  const res = await fetch(B + url, { method, headers, redirect: "manual", body: write ? JSON.stringify(body ?? {}) : undefined });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  return { status: res.status, json, text, location: res.headers.get("location") ?? "" };
}
async function fp() {
  const a = await Q(`select * from "AppAccess" order by id`);
  const u = await Q(`select id, "isAdmin", "isAccessAdmin" from "User" order by id`);
  const p = await Q(`select * from "PendingAppAccess" order by id`);
  return createHash("sha256").update(JSON.stringify([a, u, p])).digest("hex").slice(0, 16);
}
const uid = async (u) => (await Q(`select id from "User" where username=$1`, [u]))[0].id;
const rowOn = async (u, g) => (await Q(`select granted from "AppAccess" where "userId"=$1 and "appId"=$2`, [u, g]))[0]?.granted === true;

const fp0 = await fp();
const S = cookie("shadew_"), AY = cookie("ayoub_prods"), AT = cookie("atomboy7"), H = cookie("hareld"), W = cookie("wisedumdum");
const CH = cookie("chigolarry"), YO = cookie("yovcheff."), BOT = cookie("demo-tutorial"), ED = cookie("ed044426");
const WISE = await uid("wisedumdum");

try {
  // ---- decision 1: who may open and change access ----
  const me = async (c) => (await call(c, "GET", "/api/access/me")).json;
  check("access/me: owner manage + owner", (await me(S)).can === "manage" && (await me(S)).isOwner === true);
  check("access/me: Ayoub manage", (await me(AY)).can === "manage");
  check("access/me: Atom manage (access admin, not a Portal admin)", (await me(AT)).can === "manage");
  check("access/me: Harald read (Portal admin, not access admin)", (await me(H)).can === "read");
  check("access/me: plain member null", (await me(W)).can === null);
  check("access/me: signed out null", (await call(null, "GET", "/api/access/me")).json.can === null);
  const page = async (c, u) => (await call(c, "GET", u)).status;
  // X6: a member is sent to the one no-access page (307 to /no-access?want=portal.access-admin), was a bare 404
  const wAccess = await call(W, "GET", "/access");
  check("/access page: owner, Ayoub, Atom, Harald 200; member -> no-access page",
    (await page(S, "/access")) === 200 && (await page(AY, "/access")) === 200 && (await page(AT, "/access")) === 200 && (await page(H, "/access")) === 200
    && wAccess.status === 307 && wAccess.location.includes("/no-access?want=portal.access-admin"));
  const hs = await call(H, "GET", "/api/access/admin");
  check("Harald: /access state read only", hs.status === 200 && hs.json.viewer.can === "read");
  const item = { userId: WISE, changes: [{ grantId: "kpi", granted: true, expect: false }] };
  check("Harald: /access save 403", (await call(H, "POST", "/api/access/admin/changes", { items: [item] })).status === 403);
  check("Harald: old /admin PATCH 403", (await call(H, "PATCH", "/api/admin", { userId: WISE, appId: "patreon", granted: true })).status === 403);
  check("Harald: old pre-grant POST 403", (await call(H, "POST", "/api/admin/pending-access", { email: "x3@example.test", appId: "patreon", granted: true })).status === 403);
  check("Harald: old pre-grant DELETE 403", [403, 404].includes((await call(H, "DELETE", "/api/admin/pending-access", { email: "x3@example.test", appId: "patreon" })).status));
  check("Harald: wise rows unchanged", !(await rowOn(WISE, "kpi")) && !(await rowOn(WISE, "patreon")));
  const ha = await call(H, "GET", "/api/admin");
  check("Harald: old /admin list still readable (200)", ha.status === 200 && Array.isArray(ha.json) && ha.json.length >= 62);
  check("Harald: old /admin list has no Discord ids, avatars or full emails",
    ha.json.every((u) => u.discordId === "" && u.avatar === null && (!u.email || u.email.includes("***"))));
  const so = await call(S, "GET", "/api/admin");
  check("owner: old /admin list keeps Discord ids and emails", so.json.some((u) => /^\d{15,}$/.test(u.discordId)) && so.json.some((u) => u.email && !u.email.includes("***")));
  check("Atom: old /admin list 403 (not a Portal admin; uses /access)", (await call(AT, "GET", "/api/admin")).status === 403);

  // access admins change (and undo); owner-only grants refused for them
  const r1 = await call(AT, "POST", "/api/access/admin/changes", { items: [item], note: "x3 http test" });
  check("Atom: give Wise kpi 200", r1.status === 200 && (await rowOn(WISE, "kpi")), `change ${r1.json?.changeId}`);
  check("Atom: undo 200", (await call(AT, "POST", "/api/access/admin/revert", { changeId: r1.json?.changeId })).status === 200 && !(await rowOn(WISE, "kpi")));
  for (const g of ["pulse.hiring", "pulse.servers", "cases-dashboard"]) {
    const r = await call(AT, "POST", "/api/access/admin/changes", { items: [{ userId: WISE, changes: [{ grantId: g, granted: true, expect: false }] }] });
    check(`Atom: owner-only ${g} refused 403`, r.status === 403 && /only the owner/.test(r.json?.error ?? ""), r.json?.error);
  }
  const p1 = await call(AY, "PATCH", "/api/admin", { userId: WISE, appId: "patreon", granted: true });
  check("Ayoub: old /admin PATCH 200 (access admin)", p1.status === 200 && (await rowOn(WISE, "patreon")));
  check("Ayoub: undo through /access", (await call(AY, "POST", "/api/access/admin/revert", { changeId: p1.json?.changeId })).status === 200 && !(await rowOn(WISE, "patreon")));
  check("Ayoub: naming an access admin refused (owner only)", (await call(AY, "POST", "/api/access/admin/admins", { userId: WISE, on: true })).status === 403);

  // ---- review fixes (28 Nov) ----
  // S1: Ayoub (access admin + Portal admin) may not pre-grant to his own email; a new email still works
  const ayEmail = (await Q(`select email from "User" where username='ayoub_prods'`))[0]?.email;
  const pBefore = (await Q(`select count(*)::int n from "PendingAppAccess"`))[0].n;
  const selfPre = await call(AY, "POST", "/api/admin/pending-access", { email: ayEmail, appId: "renderfarm", granted: true });
  check("S1 Ayoub: self pre-grant 403", !!ayEmail && selfPre.status === 403, selfPre.json?.error);
  const newEmail = `x3-s1-${Date.now()}@example.test`;
  const okPre = await call(AY, "POST", "/api/admin/pending-access", { email: newEmail, appId: "renderfarm", granted: true });
  check("S1 Ayoub: pre-grant for a new email 200", okPre.status === 200);
  check("S1 Ayoub: delete that pre-grant 200", (await call(AY, "DELETE", "/api/admin/pending-access", { email: newEmail, appId: "renderfarm" })).status === 200
    && (await Q(`select count(*)::int n from "PendingAppAccess"`))[0].n === pBefore);
  // N1: no Discord id inside any user id for non-owners; PATCH still works with the opaque ref
  check("N1 Harald: /api/admin ids carry no Discord id", ha.json.every((u) => !/\d{15,}/.test(u.id)), `${ha.json.filter((u) => /\d{15,}/.test(u.id)).length} with`);
  const ay = (await call(AY, "GET", "/api/admin")).json;
  const refRow = ay.find((u) => u.id.startsWith("u_") && u.username !== "ayoub_prods");
  check("N1 owner: /api/admin keeps real ids", so.json.some((u) => /^portal_\d{15,}$/.test(u.id)));
  if (refRow) {
    const target = (await Q(`select id from "User" where username=$1`, [refRow.username]))[0].id;
    const had = await rowOn(target, "pulse.takedowns");
    const pr = await call(AY, "PATCH", "/api/admin", { userId: refRow.id, appId: "pulse.takedowns", granted: !had });
    check("N1 Ayoub: PATCH with an opaque ref reaches the right person", pr.status === 200 && (await rowOn(target, "pulse.takedowns")) === !had, pr.json?.error);
    check("N1 Ayoub: undo", (await call(AY, "POST", "/api/access/admin/revert", { changeId: pr.json?.changeId })).status === 200 && (await rowOn(target, "pulse.takedowns")) === had);
  } else check("N1: a user with a ref exists for Ayoub", false);
  // N4: no KPI tile while its hand-off is off (Home is server-rendered with the tile list)
  const homeHtml = (await call(ED, "GET", "/")).text;
  // X6: Home is drawn in the browser from /api/me + /api/access/me (no app addresses in the page); KPI is not offered
  const edWho = await me(ED);
  check("N4: Home has no KPI tile while signInOff", homeHtml.length > 1000 && !homeHtml.includes("kpi.insanity.team") && Array.isArray(edWho.offer) && !edWho.offer.includes("kpi"));

  // ---- B4: names, effect, hidden toggles ----
  const st = (await call(S, "GET", "/api/access/admin")).json;
  const named = st.people.filter((p) => p.name).length;
  check("B4: real names from the directory on some people", named >= 20, `${named} of ${st.people.length}`);
  check("B4: Atom shown with a real name", !!st.people.find((p) => p.username === "atomboy7")?.name);
  const cat = Object.fromEntries(st.catalog.map((g) => [g.id, g]));
  check("B4: effect now for Pulse + Desk, next sign-in for Case Profiles, tile only for Invoicing",
    cat.pulse.effect === "now" && cat.desk.effect === "now" && cat["foia-sorter"].effect === "next-sign-in" && cat.invoicing.effect === "tile-only");
  check("B4: no-op toggles marked none (Training, Video Review, Cases, KPI before switch, tabs not enforced)",
    ["insanity-courses", "video-review", "cases-dashboard", "kpi", "pulse.servers"].every((g) => cat[g].effect === "none"));
  check("B4: plain tab labels with full labels for lists", cat["pulse.servers"].label === "Servers" && cat["pulse.servers"].full === "Pulse: Servers");
  check("P8: the Hiring grant says what it opens and needs the switch", cat["pulse.hiring"].full === "Pulse: Hiring (reviewers see only their own trials)" && /HIRING_PORTAL_GRANTS/.test(cat["pulse.hiring"].toggleNote || ""));
  check("B4: owner-only flags", cat["pulse.hiring"].ownerOnly && cat["pulse.servers"].ownerOnly && cat["cases-dashboard"].ownerOnly && !cat.kpi.ownerOnly);
  check("B4: Pulse includes Production, Stuck cases, Patreon, FOIA cases", JSON.stringify(st.pulseIncluded) === JSON.stringify(["Production", "Stuck cases", "Patreon", "FOIA cases"]));
  const home = await call(S, "GET", "/");
  check("Home renders (200)", home.status === 200);

  // ---- X4a learn rule (Discord stubbed) ----
  const learn = (c) => call(c, "GET", "/api/auth/redirect?app=insanity-courses");
  const isLearn = (r) => r.status === 302 && r.location.startsWith("https://learn.insanity.team/");
  check("learn: owner 302 to learn", isLearn(await learn(S)));
  check("learn: Portal admin Harald skips the check, 302", isLearn(await learn(H)));
  check("learn: member Wise 302", isLearn(await learn(W)));
  const ch = await learn(CH);
  check("learn: non-member chigolarry 403 stranger page", ch.status === 403 && ch.text.includes("Insanity Training is for the team") && ch.text.includes("This account isn") && ch.text.includes("Try again") && ch.text.includes("Use a different Discord account") && ch.text.includes("Back to Portal"));
  check("learn: stranger page has no portal_token", !ch.text.includes("portal_token") && !ch.location);
  const yo = await learn(YO);
  check("learn: Discord error (stub 500) 503 try again", yo.status === 503 && yo.text.includes("couldn't check the team's Discord server just now"));
  const bot = await learn(BOT);
  check("learn: non-Discord id (InsanityBot demo) 503 try again, never asked", bot.status === 503);
  check("learn: signed out -> login", (await learn(null)).location.includes("/login"));

  // ---- X4b KPI ----
  const kpi = (c) => call(c, "GET", "/api/auth/redirect?app=kpi");
  const ek = await kpi(ED);
  check("kpi: Ed allowed but not switched on yet: 503, no token", ek.status === 503 && !ek.location && /not switched on yet/.test(ek.text));
  check("kpi: Wise 403", (await kpi(W)).status === 403);
  const edMe = (await call(ED, "GET", "/api/me")).json;
  check("kpi: /api/me Ed true, Wise false", edMe.access.kpi === true && (await call(W, "GET", "/api/me")).json.access.kpi === false);

  // ---- B0 test users ----
  const TL = minted("lead"), TR = minted("reviewer"), TM = minted("member");
  const tl = (await call(TL, "GET", "/api/me")).json, tm = (await call(TM, "GET", "/api/me")).json, tr = (await call(TR, "GET", "/api/me")).json;
  check("B0: TEST lead has Pulse, is no admin", tl?.access?.pulse === true && tl.isAdmin === false);
  check("B0: TEST reviewer: no whole Pulse, handoff to Pulse admitted by pulse.hiring", tr?.access?.pulse === false && (await call(TR, "GET", "/api/auth/redirect?app=pulse")).location.startsWith("https://pulse.insanity.team/"));
  check("B0: TEST member: Desk + Invoicing, no Pulse", tm?.access?.desk === true && tm.access.invoicing === true && tm.access.pulse === false);
  const tlAccess = await call(TL, "GET", "/access");
  check("B0: TEST lead cannot open /access (no-access page)", tlAccess.status === 307 && tlAccess.location.includes("/no-access?want=portal.access-admin") && (await me(TL)).can === null);
  check("B0: TEST member learn = try again (never asked Discord)", (await learn(TM)).status === 503);
  const deskRow = (await Q(`select a."grantedBy" from "AppAccess" a join "User" u on u.id=a."userId" where u."discordId"='test:member' and a."appId"='desk'`))[0];
  check("B0: TEST member Desk row not touched by the team sync (grantedBy owner, not auto)", deskRow && deskRow.grantedBy !== "auto:discord-team");
  const devTok = node("tools/dev_login.mjs", ["test:lead"]);
  check("B0: a test session without testUntil is refused by auth.ts", (await call(devTok, "GET", "/api/me")).status === 401);
} catch (e) {
  check(`no exception (${e?.message ?? e})`, false);
}
const fp1 = await fp();
check("AppAccess + User flags + pre-grants identical to the start", fp0 === fp1, `${fp0} / ${fp1}`);
await db.end();
const failed = results.filter((r) => !r).length;
console.log(`${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
