#!/usr/bin/env node
// DEV ONLY (X6, R-3258 B8 + S4): "Ask for access" over HTTP on the X6 test copy (127.0.0.1:3906, portal_dev).
//   cd /opt/access-dev/portal-x6 && sudo -u accessdev node tools/x6_http_test.mjs
// Needs the B0 test users (tools/test_users.mjs create --apply) for the Hiring-only and member roles.
// Roles: owner shadew_; access admins ayoub_prods (also Portal admin) and atomboy7; read-only Portal admin hareld;
// plain member wisedumdum; Hiring-only TEST reviewer; TEST member; signed out.
// Every ask, grant and audit row this run writes is removed at the end; the fingerprint of AppAccess + User flags +
// PendingAppAccess + AccessRequest must equal the start. Prints usernames only (no cookies, ids or env values).
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
const B = process.env.X6_BASE ?? "http://127.0.0.1:3906";
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const Q = async (sql, args = []) => (await db.query(sql, args)).rows;
const results = [];
const check = (name, ok, detail = "") => { results.push(!!ok); console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? "  " + detail : ""}`); };
const cookie = (who) => execFileSync("node", [path.join(root, "tools/dev_login.mjs"), who], { cwd: root, encoding: "utf8" }).trim();
async function call(c, method, url, body, extra = {}) {
  const write = method !== "GET";
  const headers = { ...(c ? { Cookie: c } : {}), ...(write ? { Origin: B, "Content-Type": "application/json" } : {}), ...extra };
  for (const k of Object.keys(headers)) if (headers[k] === null) delete headers[k];
  const res = await fetch(B + url, { method, headers, redirect: "manual", body: write ? (typeof body === "string" ? body : JSON.stringify(body ?? {})) : undefined });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  return { status: res.status, json, text, location: res.headers.get("location") ?? "" };
}
async function fp() {
  const a = await Q(`select * from "AppAccess" order by id`);
  const u = await Q(`select id, "isAdmin", "isAccessAdmin" from "User" order by id`);
  const p = await Q(`select * from "PendingAppAccess" order by id`);
  const r = await Q(`select * from "AccessRequest" order by id`);
  return createHash("sha256").update(JSON.stringify([a, u, p, r])).digest("hex").slice(0, 16);
}
const uid = async (u) => (await Q(`select id from "User" where username=$1`, [u]))[0].id;
const rowOn = async (u, g) => (await Q(`select granted from "AppAccess" where "userId"=$1 and "appId"=$2`, [u, g]))[0]?.granted === true;
// React puts <!-- --> between text parts of one line: drop those before matching words
const html = async (c, u) => (await call(c, "GET", u)).text.replace(/<!-- -->/g, "");
const has = (text, ...needles) => needles.every((n) => text.includes(n));
const ask = (c, grantId, reason) => call(c, "POST", "/api/access/ask", { grantId, reason });
const reqs = async (c) => (await call(c, "GET", "/api/access/admin/requests")).json;
const rowFor = (list, username, grantId) => [...(list?.open ?? []), ...(list?.answered ?? [])].find((r) => r.person.username === username && r.grantId === grantId);
const answer = (c, id, action, note) => call(c, "POST", "/api/access/admin/requests", { id, action, note });

const start = new Date();
const fp0 = await fp();
const S = cookie("shadew_"), AY = cookie("ayoub_prods"), AT = cookie("atomboy7"), H = cookie("hareld"), W = cookie("wisedumdum");
// B0 test users sign in only with a minted session (testUntil claim): tools/test_users.mjs mint <role> --out $X6_SESSIONS
const SESS = process.env.X6_SESSIONS ?? "/opt/access-dev/x6/sessions";
function minted(role) {
  const f = readFileSync(path.join(SESS, `${role}.cookie`), "utf8").split("\n").find((l) => l && !l.startsWith("#")).split("\t");
  return `${f[5]}=${f[6]}`;
}
const R = minted("reviewer"), M = minted("member");
const WISE = await uid("wisedumdum");

try {
  // ---- signed out ----
  const so = await call(null, "GET", "/no-access?want=pulse.hiring");
  check("signed out: no-access page 200 with Sign in and the full return address", so.status === 200 && has(so.text, "Sign in to continue", "callbackUrl=%2Fno-access%3Fwant%3Dpulse.hiring") && !so.text.includes("Ask for access"));
  check("signed out: ask 401", (await ask(null, "pulse")).status === 401);
  check("signed out: requests list 404", (await call(null, "GET", "/api/access/admin/requests")).status === 404);
  check("signed out: hand-off goes to sign-in (unchanged)", (await call(null, "GET", "/api/auth/redirect?app=pulse")).location.includes("/login"));

  // ---- every wall a plain member meets shows the page ----
  check("member has no Pulse (test setup)", !(await rowOn(WISE, "pulse")));
  const ref = await call(W, "GET", "/api/auth/redirect?app=pulse");
  check("member: Portal hand-off refusal = 403 that opens /no-access?want=pulse", ref.status === 403 && ref.text.includes(`http-equiv="refresh" content="0;url=${B}/no-access?want=pulse"`) && ref.text.includes("Ask for access"));
  const acc = await call(W, "GET", "/access");
  check("member: /access sends to /no-access?want=portal.access-admin", [307, 308].includes(acc.status) && acc.location.endsWith("/no-access?want=portal.access-admin"));
  const np = await html(W, "/no-access?want=pulse");
  check("member: page says what it is, who decides, one Ask button", has(np, "Pulse is not open for you yet", "Production numbers, stuck cases", "Samuel, Ayoub or Atom decide who can open it.", "Ask for access"));
  check("member: page has no system words", !/PORTAL HANDOFF|LOCKED|Command Center|Authenticate|insanity\.team/i.test(np.replace(/<script[\s\S]*?<\/script>/g, "")));
  // X7 owner ask (R-2000 backtest): owner-decided things CAN be asked for from their own page (only Samuel answers);
  // old tools still cannot. They stay off a plain member's Home offer (checked below).
  const sv = await html(W, "/no-access?want=pulse.servers");
  check("member: owner-only grant = Samuel decides + Ask button", has(sv, "Servers in Pulse is not open for you", "Samuel decides who can open it.", "Ask for access") && !sv.includes("gives this one"));
  const hv = await html(W, "/no-access?want=pulse.hiring");
  check("member: Hiring page = Samuel decides + Ask button", has(hv, "Samuel decides who can open it.", "Ask for access"));
  const fb = await html(W, "/no-access?want=foia-bot");
  check("member: old tool (Archive) = plain line, no Ask button", has(fb, "This is an old tool or one with its own sign-in.") && !fb.includes("Ask for access"));
  for (const g of ["cases-dashboard", "pulse.servers", "pulse.hiring", "frontwind-dubbing"]) {
    const r = await ask(W, g, "");
    check(`member: ask for owner-decided ${g} = 200 open, one row`, r.status === 200 && r.json?.state === "open"
      && (await Q(`select count(*)::int n from "AccessRequest" where "userId"=$1 and "grantId"=$2 and state='open'`, [WISE, g]))[0].n === 1, `HTTP ${r.status} ${r.json?.state ?? r.json?.error ?? ""}`);
    const atR = rowFor(await reqs(AT), "wisedumdum", g);
    check(`owner-decided ${g}: Atom sees 'Only Samuel can answer this one.', approve 403`, atR && !atR.canAnswer && atR.whyNot === "Only Samuel can answer this one."
      && (await answer(AT, atR.id, "approve")).status === 403 && !(await rowOn(WISE, g)));
    const sR = rowFor(await reqs(S), "wisedumdum", g);
    check(`owner-decided ${g}: Samuel may answer`, !!sR?.canAnswer);
  }
  check("member: owner-decided page now says Asked, Samuel will answer", has(await html(W, "/no-access?want=pulse.hiring"), "You asked for", "Samuel will answer."));
  // free Wise's open-ask slots for the rest of the run (the end clean-up deletes them anyway)
  await Q(`delete from "AccessRequest" where "userId"=$1 and "createdAt" >= $2 and "grantId" = any($3)`, [WISE, start, ["cases-dashboard", "pulse.servers", "pulse.hiring", "frontwind-dubbing"]]);
  // X7 owner ask (2): the Hiring switch on Samuel's person page follows HIRING_PORTAL_GRANTS / PULSE_HIRING_GRANTS_ON
  const hOn = ["1", "true", "on"].includes((process.env.PULSE_HIRING_GRANTS_ON ?? process.env.HIRING_PORTAL_GRANTS ?? "").trim().toLowerCase());
  const catOf = async (c) => Object.fromEntries(((await call(c, "GET", "/api/access/admin")).json?.catalog ?? []).map((g) => [g.id, g]));
  const sCat = await catOf(S), atCat = await catOf(AT);
  check(`owner: Hiring switch shown = switch ${hOn ? "on" : "off"}`, sCat["pulse.hiring"]?.shown === hOn, String(sCat["pulse.hiring"]?.shown));
  check("access admin: Hiring switch never shown (owner-only)", atCat["pulse.hiring"]?.shown === false);
  check("owner: Servers and Takedowns switches stay hidden (no effect yet)", sCat["pulse.servers"]?.shown === false && sCat["pulse.takedowns"]?.shown === false && sCat.pulse?.shown === true);
  for (const g of ["foia-bot", "patreon", "pd-lookup", "invoicing"]) {
    const r = await ask(W, g, "");
    check(`member: ask for old / tile-only ${g} = 403 (or has)`, (r.status === 403 && /old tool/.test(r.json?.error ?? "")) || r.json?.state === "has");
  }
  const wOffer = (await call(W, "GET", "/api/access/me")).json.offer ?? [];
  check("member: Home offer has no owner-decided or old tools, keeps Pulse + Takedowns-free app list",
    ["cases-dashboard", "frontwind-dubbing", "foia-bot", "patreon", "pd-lookup", "invoicing", "kpi", "ayoub-private-assistant"].every((g) => !wOffer.includes(g)) && wOffer.includes("pulse"), wOffer.join(","));
  const tk = await ask(W, "pulse.takedowns", "");
  check("member: Takedowns stays askable (Copyright plan: Ask for access button)", tk.status === 200 && tk.json?.state === "open");
  const sOffer = (await call(AT, "GET", "/api/access/me")).json.offer ?? [];
  check("access admin: owner-decided apps still offered (owner answers), old tools not", sOffer.includes("cases-dashboard") && !sOffer.includes("foia-bot"));
  check("member: personal app = no ask button", has(await html(W, "/no-access?want=ayoub-private-assistant"), "This page is not open for you") && !(await html(W, "/no-access?want=ayoub-private-assistant")).includes("Ask for access"));
  check("member: unknown want = no ask button", !(await html(W, "/no-access?want=nope")).includes("Ask for access"));
  const hasFs = await rowOn(WISE, "foia-sorter");
  check("member: a grant they have says Open", !hasFs || has(await html(W, "/no-access?want=foia-sorter"), "You have FOIA Sorter", "Open FOIA Sorter"));
  check("member: Home 200", (await call(W, "GET", "/")).status === 200);

  // ---- CSRF / origin on the new write routes (like M3 guard) ----
  check("ask: no Origin 403", (await call(W, "POST", "/api/access/ask", { grantId: "pulse" }, { Origin: null })).status === 403);
  check("ask: other Origin 403", (await call(W, "POST", "/api/access/ask", { grantId: "pulse" }, { Origin: "https://evil.example" })).status === 403);
  check("ask: text/plain 403", (await call(W, "POST", "/api/access/ask", JSON.stringify({ grantId: "pulse" }), { "Content-Type": "text/plain" })).status === 403);
  check("answer: no Origin 403 (Atom)", (await call(AT, "POST", "/api/access/admin/requests", { id: "x", action: "approve" }, { Origin: null })).status === 403);
  check("answer: other Origin 403 (Atom)", (await call(AT, "POST", "/api/access/admin/requests", { id: "x", action: "approve" }, { Origin: "https://evil.example" })).status === 403);
  check("CSRF refusals wrote nothing", (await Q(`select count(*)::int n from "AccessRequest" where "createdAt" >= $1 and "grantId"='pulse'`, [start]))[0].n === 0);

  // ---- ask, duplicate, has, bad input ----
  const a1 = await ask(W, "pulse", "I review edits\n<b>for Atom</b>\u0007");
  check("member: ask Pulse 200 open", a1.status === 200 && a1.json.state === "open" && !!a1.json.at);
  const a2 = await ask(W, "pulse", "again");
  check("member: duplicate ask = same open ask, no second row", a2.status === 200 && a2.json.already === true && a2.json.at === a1.json.at &&
    (await Q(`select count(*)::int n from "AccessRequest" where "userId"=$1 and "grantId"='pulse'`, [WISE]))[0].n === 1);
  const stored = (await Q(`select reason from "AccessRequest" where "userId"=$1 and "grantId"='pulse'`, [WISE]))[0].reason;
  check("reason stored as one clean line", stored === "I review edits <b>for Atom</b>");
  if (hasFs) check("member: ask for a grant they have = has, no row", (await ask(W, "foia-sorter")).json?.state === "has");
  check("member: unknown grant 400", (await ask(W, "nope")).status === 400);
  check("member: personal app 400", (await ask(W, "ayoub-private-assistant")).status === 400);
  check("member: KPI (sign-in off) 400", (await ask(W, "kpi")).status === 400);
  const after = await html(W, "/no-access?want=pulse");
  check("member: page now says Asked on <date>, who will answer", has(after, "You asked for Pulse", "Asked on ", "Samuel, Ayoub or Atom will answer.") && !after.includes(">Ask for access<"));
  const wme = (await call(W, "GET", "/api/access/me")).json;
  check("member: /api/access/me lists the open ask", wme.asks.some((x) => x.grantId === "pulse" && x.state === "open") && wme.can === null && wme.waiting === 0);
  check("member: requests list 404, answer 404", (await call(W, "GET", "/api/access/admin/requests")).status === 404 && (await answer(W, "x", "approve")).status === 404);

  // ---- admins see it ----
  const hl = await reqs(H);
  const hRow = rowFor(hl, "wisedumdum", "pulse");
  check("read-only admin (Harald): sees the ask, no buttons", !!hRow && hRow.canAnswer === false && hRow.whyNot === null);
  check("read-only admin: answer 403", (await answer(H, hRow?.id, "approve")).status === 403);
  const al = await call(AT, "GET", "/api/access/admin/requests");
  const atRow = rowFor(al.json, "wisedumdum", "pulse");
  check("Atom: sees the ask with Approve allowed, reason and plain name", !!atRow && atRow.canAnswer && atRow.grant === "Pulse" && atRow.reason === stored && atRow.person.name === "Jokubas Sireikis");
  check("Atom: no Discord ids in the requests answer", !/\d{15,}/.test(al.text));
  check("Atom: Home badge counts it", (await call(AT, "GET", "/api/access/me")).json.waiting >= 1);
  check("owner: sees it too", !!rowFor(await reqs(S), "wisedumdum", "pulse")?.canAnswer);

  // ---- approve -> access, audit row, Undo ----
  const ap = await answer(AT, atRow.id, "approve");
  check("Atom approves: 200 with a change id", ap.status === 200 && ap.json.state === "approved" && !!ap.json.changeId);
  check("member now holds Pulse", await rowOn(WISE, "pulse"));
  const audit = await Q(`select "grantId", "oldState", "newState", note, "targetUserId" from "AccessAudit" where "changeId"=$1`, [ap.json?.changeId ?? ""]);
  check("audit row: pulse none -> on, note 'ask approved'", audit.length === 1 && audit[0].grantId === "pulse" && audit[0].newState === "on" && audit[0].note === "ask approved" && audit[0].targetUserId === WISE);
  check("member: hand-off now opens Pulse", (await call(W, "GET", "/api/auth/redirect?app=pulse")).status === 302);
  check("member: page now says You have Pulse", has(await html(W, "/no-access?want=pulse"), "You have Pulse", "Open Pulse"));
  check("member: /api/access/me shows it given by Atom", (await call(W, "GET", "/api/access/me")).json.asks.some((x) => x.grantId === "pulse" && x.state === "approved" && x.by === "Atom"));
  check("second answer 409", (await answer(AY, atRow.id, "approve")).status === 409);
  const undo = await call(AT, "POST", "/api/access/admin/revert", { changeId: ap.json.changeId });
  check("Undo (History path) 200, Pulse gone again", undo.status === 200 && !(await rowOn(WISE, "pulse")));
  check("answered list marks it undone", rowFor(await reqs(AT), "wisedumdum", "pulse")?.undone === true);
  check("member: hand-off refused again", (await call(W, "GET", "/api/auth/redirect?app=pulse")).status === 403);

  // ---- decline path ----
  const target = (await rowOn(WISE, "script-reviewer")) ? "police-report-analyzer" : "script-reviewer";
  await ask(W, target, "");
  const dRow = rowFor(await reqs(AY), "wisedumdum", target);
  const dec = await answer(AY, dRow.id, "decline", "Not for writers yet");
  check("Ayoub declines with a note", dec.status === 200 && dec.json.state === "declined" && !(await rowOn(WISE, target)));
  const dp = await html(W, `/no-access?want=${target}`);
  check("member: sees Declined on <date> by Ayoub, the note, and Ask again", has(dp, "Declined on ", "by Ayoub", "Not for writers yet", "Ask again"));
  const again = await ask(W, target, "Now I write scripts");
  check("member: can ask again after a decline (new open ask)", again.status === 200 && again.json.state === "open" && !again.json.already &&
    (await Q(`select count(*)::int n from "AccessRequest" where "userId"=$1 and "grantId"=$2 and state='open'`, [WISE, target]))[0].n === 1);
  check("answer with a bad action 400", (await answer(AY, rowFor(await reqs(AY), "wisedumdum", target)?.id, "maybe")).status === 400);

  // ---- owner-only ask ----
  // Harald (read-only Portal admin) asks; a plain member may ask too since X7 (checked above)
  const HAR = await uid("hareld");
  const hAsk = await ask(H, "pulse.servers", "");
  check("Portal admin may ask for an owner-only grant", hAsk.status === 200 && hAsk.json?.state === "open", `HTTP ${hAsk.status} ${hAsk.json?.state ?? hAsk.json?.error ?? ""}`);
  const oRowAt = rowFor(await reqs(AT), "hareld", "pulse.servers");
  check("owner-only ask: Atom sees 'Only Samuel can answer this one.'", oRowAt && !oRowAt.canAnswer && oRowAt.whyNot === "Only Samuel can answer this one.");
  check("owner-only ask: Atom approve 403, nothing written", (await answer(AT, oRowAt.id, "approve")).status === 403 && !(await rowOn(HAR, "pulse.servers")));
  check("owner-only ask: Ayoub decline 403 too", (await answer(AY, oRowAt.id, "decline")).status === 403);
  const oAp = await answer(S, oRowAt.id, "approve");
  check("owner approves owner-only ask", oAp.status === 200 && (await rowOn(HAR, "pulse.servers")) && !!oAp.json.changeId);
  check("owner Undo", (await call(S, "POST", "/api/access/admin/revert", { changeId: oAp.json.changeId })).status === 200 && !(await rowOn(HAR, "pulse.servers")));

  // ---- own ask ----
  const ATOM = await uid("atomboy7");
  const own = (await rowOn(ATOM, "police-report-analyzer")) ? "foia-researcher" : "police-report-analyzer";
  const ownAsk = await ask(AT, own, "");
  const ownRow = rowFor(await reqs(AT), "atomboy7", own);
  check("Atom asks for himself; cannot answer his own ask", ownAsk.json?.state === "open" && ownRow && !ownRow.canAnswer && ownRow.whyNot === "You cannot answer your own ask.");
  check("Atom approving his own ask 403", (await answer(AT, ownRow.id, "approve")).status === 403 && !(await rowOn(ATOM, own)));
  const ayAp = await answer(AY, ownRow.id, "approve");
  check("Ayoub may approve Atom's ask", ayAp.status === 200 && (await rowOn(ATOM, own)));
  check("Ayoub Undo", (await call(AY, "POST", "/api/access/admin/revert", { changeId: ayAp.json.changeId })).status === 200 && !(await rowOn(ATOM, own)));

  // ---- ask to become an access admin (from /access) ----
  const aa = await ask(W, "portal.access-admin", "I want to help with access");
  const aaRow = rowFor(await reqs(AY), "wisedumdum", "portal.access-admin");
  check("access-admin ask: Ayoub cannot answer (owner only)", aa.json?.state === "open" && aaRow && !aaRow.canAnswer && (await answer(AY, aaRow.id, "approve")).status === 403);
  const aaAp = await answer(S, aaRow.id, "approve");
  const wiseAdmin = async () => (await Q(`select "isAccessAdmin" from "User" where id=$1`, [WISE]))[0].isAccessAdmin;
  check("owner approves: member is an access admin (setAccessAdmin, audited)", aaAp.status === 200 && (await wiseAdmin()) === true && !!aaAp.json.changeId);
  check("owner Undo: no longer an access admin", (await call(S, "POST", "/api/access/admin/revert", { changeId: aaAp.json.changeId })).status === 200 && (await wiseAdmin()) === false);

  // ---- Hiring-only person (TEST reviewer) ----
  const rme = (await call(R, "GET", "/api/access/me")).json;
  check("Hiring-only: Home gets the Hiring tile (tiles = pulse.hiring)", JSON.stringify(rme.tiles) === JSON.stringify(["pulse.hiring"]));
  const rh = await call(R, "GET", "/api/auth/redirect?app=pulse&next=%2F%23hiring");
  check("Hiring-only: the tile's hand-off opens Pulse on Hiring", rh.status === 302 && rh.location.startsWith("https://pulse.insanity.team/auth/portal") && rh.location.includes("next=%2F%23hiring"));
  check("Hiring-only: no-access for Hiring = You have Hiring + how reviewers see it", has(await html(R, "/no-access?want=pulse.hiring"), "You have Hiring in Pulse", "only the trials where you are the reviewer"));
  check("Hiring-only: Pulse as a whole still askable", has(await html(R, "/no-access?want=pulse"), "Ask for access"));
  check("member without Hiring: no tiles", JSON.stringify((await call(M, "GET", "/api/access/me")).json.tiles) === "[]");
  check("full Pulse holder: no extra Hiring tile", JSON.stringify((await call(S, "GET", "/api/access/me")).json.tiles) === "[]");

  // ---- review fixes (Fable gate 1, 28 Nov) ----
  // F6: bidi overrides and zero-width marks are stripped from the reason (same class as the feedback cleaner)
  const pick = [];
  for (const g of ["insanity-extension", "autobot", "foia-researcher"]) if (!(await rowOn(WISE, g))) pick.push(g);
  const [g1, g2] = pick;
  check("F setup: two apps the member does not hold", !!g1 && !!g2, pick.join(","));
  const bidi = await ask(W, g1, "need \u202Eit\u202C for \u200Bscripts\u2066x\u2069");
  const bRow = (await Q(`select id, reason from "AccessRequest" where "userId"=$1 and "grantId"=$2 and state='open'`, [WISE, g1]))[0];
  check("F6: ask reason stored without bidi or zero-width characters", bidi.status === 200 && !!bRow && !/[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/.test(bRow.reason ?? "") && bRow.reason.includes("scripts"), JSON.stringify(bRow?.reason ?? null));
  // F2a: crash between the claim and the final update (row left "approving" 3 minutes ago, nothing granted)
  await Q(`update "AccessRequest" set state='approving', "decidedAt"=now() - interval '3 minutes', "decidedBy"='crashed', "decidedByName"='Atom' where id=$1`, [bRow.id]);
  check("F2: a stuck 'approving' ask still shows as open in the list", rowFor(await reqs(AT), "wisedumdum", g1)?.state === "open");
  const st = await answer(AT, bRow.id, "approve");
  check("F2: a stuck 'approving' ask older than 2 minutes can be approved again", st.status === 200 && st.json?.state === "approved" && !!st.json?.changeId && (await rowOn(WISE, g1)), `HTTP ${st.status} ${st.json?.error ?? ""}`);
  check("F2: the row is closed (approved, openKey cleared)", (await Q(`select state, "openKey" from "AccessRequest" where id=$1`, [bRow.id]))[0].state === "approved");
  check("F2: Undo of that approve", (await call(AT, "POST", "/api/access/admin/revert", { changeId: st.json?.changeId })).status === 200 && !(await rowOn(WISE, g1)));
  // F2b: a claim of 30 seconds ago is someone else's answer in progress: 409, nothing written
  await ask(W, g2, "");
  const fRow = (await Q(`select id from "AccessRequest" where "userId"=$1 and "grantId"=$2 and state='open'`, [WISE, g2]))[0];
  await Q(`update "AccessRequest" set state='approving', "decidedAt"=now() - interval '30 seconds', "decidedBy"='other', "decidedByName"='Ayoub' where id=$1`, [fRow.id]);
  const fresh = await answer(AT, fRow.id, "approve");
  check("F2: a fresh claim (30 s) stays protected: 409, nothing granted", fresh.status === 409 && !(await rowOn(WISE, g2)), `HTTP ${fresh.status}`);
  const freshDecline = await answer(AT, fRow.id, "decline");
  check("F2: decline of a fresh claim 409 too", freshDecline.status === 409);
  // F2c + F9: crash after the grant was saved but before the ask closed (grant held, row stuck "approving")
  await Q(`update "AccessRequest" set state='open', "decidedAt"=null, "decidedBy"=null, "decidedByName"=null where id=$1`, [fRow.id]);
  const ok2 = await answer(AT, fRow.id, "approve");
  await Q(`update "AccessRequest" set state='approving', "openKey"="userId" || '|' || "grantId", "changeId"=null, "decidedAt"=now() - interval '3 minutes' where id=$1`, [fRow.id]);
  check("F9: open ask for a grant the person holds is left out of the Requests list", ok2.status === 200 && (await rowOn(WISE, g2)) && !(await reqs(AT)).open.some((r) => r.id === fRow.id));
  const wme9 = (await call(W, "GET", "/api/access/me")).json;
  check("F9: and out of the member's own open asks (badge and rows agree)", !wme9.asks.some((a) => a.grantId === g2 && a.state === "open"));
  const re = await answer(AT, fRow.id, "approve");
  check("F2: approving the stuck row again closes it with no new change (already had it)", re.status === 200 && re.json?.state === "approved" && !re.json?.changeId
    && (await Q(`select state from "AccessRequest" where id=$1`, [fRow.id]))[0].state === "approved", `HTTP ${re.status} ${re.json?.changeId ?? ""}`);
  check("F2: Undo of the first approve still works", (await call(AT, "POST", "/api/access/admin/revert", { changeId: ok2.json?.changeId })).status === 200 && !(await rowOn(WISE, g2)));
  // F6: decline note cleaned too
  await ask(W, g1, "");
  const nRow = rowFor(await reqs(AY), "wisedumdum", g1);
  await answer(AY, nRow?.id, "decline", "not \u202Enow\u202C\u200B");
  const note = (await Q(`select "decisionNote" from "AccessRequest" where id=$1`, [nRow?.id ?? ""]))[0]?.decisionNote ?? "";
  check("F6: decline note stored without bidi or zero-width characters", note === "not now", JSON.stringify(note));

  // ---- limits ----
  const many = ["pulse", "script-reviewer", "insanity-extension", "foia-researcher", "autobot", "police-report-analyzer", "foia-sorter", "pulse.takedowns", "desk.production", "foia-sorter.distribution", "foia-sorter.patreon", "foia-sorter.podcast"];
  const outs = [];
  for (const g of many) { const r = await ask(M, g, ""); outs.push(r.status === 409 ? "409" : r.json?.state ?? `HTTP ${r.status}`); }
  const openM = (await Q(`select count(*)::int n from "AccessRequest" a join "User" u on u.id=a."userId" where u."discordId"='test:member' and a.state='open'`))[0].n;
  check("limit: at most 10 open asks per person, then 409 in plain words", openM === 10 && outs.filter((o) => o === "409").length === outs.length - 10, `open ${openM}, answers ${outs.join(",")}`);
} catch (err) {
  check("no crash", false, String(err?.stack ?? err).split("\n").slice(0, 3).join(" | "));
} finally {
  // clean up: asks, the audit rows and grants this run wrote (every grant change above was undone through the app)
  await Q(`delete from "AccessRequest" where "createdAt" >= $1`, [start]);
  const n = (await Q(`delete from "AccessAudit" where at >= $1 and note is distinct from 'B0 test users (hub decision 28 Nov 2026, R-3258)' returning id`, [start])).length;
  console.log(`cleanup: removed this run's asks and ${n} audit rows`);
  const fp1 = await fp();
  check("fingerprint equal (AppAccess, User flags, pre-grants, asks)", fp0 === fp1, `${fp0} ${fp1}`);
  await db.end();
  const pass = results.filter(Boolean).length;
  console.log(`\n${pass}/${results.length} pass`);
  process.exit(pass === results.length ? 0 : 1);
}
