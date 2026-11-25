#!/usr/bin/env node
// DEV ONLY (R-2159 M3): the /access dashboard API over HTTP against the test copy (127.0.0.1:3900, portal_dev).
//   cd /opt/access-dev/portal && sudo -u accessdev node tools/m3_test.mjs
// Signs in with tools/dev_login.mjs as: owner (shadew_), Portal admin (hareld), normal user (atomboy7, also made an
// access admin for part of the run). Refuses unless DATABASE_URL names portal_dev. Takes a fingerprint of AppAccess +
// User flags + PendingAppAccess + AccessRole at the start; at the end it must be equal. If not, it restores AppAccess
// and the User flags from the start snapshot (dev DB only) and fails. AccessAudit rows stay (evidence).
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import pg from "pg";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: path.join(root, ".env"), quiet: true });
if (!/\/portal_dev(\?|$)/.test(process.env.DATABASE_URL ?? "")) { console.error("refused: DATABASE_URL is not portal_dev"); process.exit(2); }
const B = "http://127.0.0.1:3900";
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const Q = async (sql, args = []) => (await db.query(sql, args)).rows;

const results = [];
const check = (name, ok, detail = "") => { results.push(!!ok); console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? "  " + detail : ""}`); };
const cookie = (who) => execFileSync("node", [path.join(root, "tools/dev_login.mjs"), who], { cwd: root, encoding: "utf8" }).trim();
// Writes go out like the dashboard sends them: Origin = the Portal origin, JSON body. opts.origin / opts.type override
// (null = leave the header out) for the CSRF checks.
async function call(c, method, url, body, opts = {}) {
  const write = method !== "GET";
  const headers = { ...(c ? { Cookie: c } : {}) };
  const origin = "origin" in opts ? opts.origin : write ? B : null;
  const type = "type" in opts ? opts.type : write ? "application/json" : null;
  if (origin) headers.Origin = origin;
  if (type) headers["Content-Type"] = type;
  const res = await fetch(B + url, { method, headers, body: write ? (typeof body === "string" ? body : JSON.stringify(body ?? {})) : undefined });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  return { status: res.status, json, text };
}

async function snapshot() {
  const access = await Q(`select * from "AppAccess" order by id`);
  const users = await Q(`select id, "isAdmin", "isAccessAdmin" from "User" order by id`);
  const pending = await Q(`select * from "PendingAppAccess" order by id`);
  const roles = await Q(`select * from "AccessRole" order by id`);
  return { access, users, pending, roles, fp: createHash("sha256").update(JSON.stringify([access, users, pending, roles])).digest("hex").slice(0, 16) };
}
const fpNow = async () => (await snapshot()).fp;

const start = await snapshot();
const id = async (u) => (await Q(`select id from "User" where username=$1`, [u]))[0].id;
const [OWNER, HARELD, ATOM, AMINO] = [await id("shadew_"), await id("hareld"), await id("atomboy7"), await id("amino1473")];
// a 4th person for batches: first non-admin user that is not one of the above
const OTHER = (await Q(`select id from "User" where "isAdmin"=false and id <> all($1) order by username limit 1`, [[ATOM, AMINO]]))[0].id;
const S = cookie("shadew_"), H = cookie("hareld"), T = cookie("atomboy7");
const rowOn = async (u, g) => (await Q(`select granted from "AppAccess" where "userId"=$1 and "appId"=$2`, [u, g]))[0]?.granted === true;

try {
  // ---- who may open it ----
  const so = await call(S, "GET", "/api/access/admin");
  check("owner: state 200, can manage", so.status === 200 && so.json.viewer.can === "manage" && so.json.viewer.isOwner);
  const ho = await call(H, "GET", "/api/access/admin");
  check("Portal admin: state 200, read only", ho.status === 200 && ho.json.viewer.can === "read");
  check("normal user: state 404", (await call(T, "GET", "/api/access/admin")).status === 404);
  check("signed out: state 404", (await call(null, "GET", "/api/access/admin")).status === 404);
  check("page /access: owner 200, Portal admin 200, normal user 404",
    (await call(S, "GET", "/access")).status === 200 && (await call(H, "GET", "/access")).status === 200 && (await call(T, "GET", "/access")).status === 404);
  const reads = ["/api/access/admin/audit", "/api/access/admin/pending", "/api/access/admin/presets"];
  check("normal user: every read route 404", (await Promise.all(reads.map((u) => call(T, "GET", u)))).every((r) => r.status === 404));
  check("Portal admin: read routes 200", (await Promise.all(reads.map((u) => call(H, "GET", u)))).every((r) => r.status === 200));
  const item = { userId: AMINO, changes: [{ grantId: "patreon", granted: true, expect: false }] };
  const writes = [
    ["POST", "/api/access/admin/changes", { items: [item] }],
    ["POST", "/api/access/admin/revert", { changeId: "x" }],
    ["POST", "/api/access/admin/presets", { name: "m3 x", grantIds: [] }],
    ["PATCH", "/api/access/admin/presets/x", { name: "m3 x", grantIds: [] }],
    ["DELETE", "/api/access/admin/presets/x"],
    ["POST", "/api/access/admin/admins", { userId: AMINO, on: true }],
  ];
  const hw = await Promise.all(writes.map(([m, u, b]) => call(H, m, u, b)));
  check("Portal admin: every write route 403", hw.every((r) => r.status === 403), hw.map((r) => r.status).join(","));
  const tw = await Promise.all(writes.map(([m, u, b]) => call(T, m, u, b)));
  check("normal user: every write route 404", tw.every((r) => r.status === 404), tw.map((r) => r.status).join(","));
  check("normal user: preview + dry run 404",
    (await call(T, "POST", "/api/access/admin/preview", { userId: AMINO, staged: {} })).status === 404 &&
    (await call(T, "POST", "/api/access/admin/changes", { items: [item], dryRun: true })).status === 404);
  check("Portal admin: dry run allowed (200), writes nothing", (await call(H, "POST", "/api/access/admin/changes", { items: [item], dryRun: true })).status === 200 && (await fpNow()) === start.fp);
  check("no Discord ids in people payload text fields", so.json.people.every((p) => !/^\d{15,}$/.test(p.username)) && !("discordId" in so.json.people[0]));

  // ---- preview uses the shared rule ----
  const p1 = await call(S, "POST", "/api/access/admin/preview", { userId: AMINO, staged: { "pulse.hiring": true, pulse: false } });
  check("preview: tab without its app is not visible (needs app)", p1.status === 200 && !p1.json.after.includes("pulse.hiring"));
  const p2 = await call(S, "POST", "/api/access/admin/preview", { userId: AMINO, staged: { "pulse.hiring": true, pulse: true } });
  check("preview: tab + app visible", p2.json.after.includes("pulse.hiring") && p2.json.after.includes("pulse"));
  check("preview: unknown grant 400", (await call(S, "POST", "/api/access/admin/preview", { userId: AMINO, staged: { "nope.x": true } })).status === 400);
  check("preview wrote nothing", (await fpNow()) === start.fp);

  // ---- batch: dry run, save = one change id, undo batch ----
  const before = { a: await rowOn(AMINO, "patreon"), b: await rowOn(OTHER, "pulse") };
  const batch = [
    { userId: AMINO, changes: [{ grantId: "patreon", granted: !before.a, expect: before.a }, { grantId: "pulse.hiring", granted: true, expect: await rowOn(AMINO, "pulse.hiring") }] },
    { userId: OTHER, changes: [{ grantId: "pulse", granted: !before.b, expect: before.b }, { grantId: "pulse.hiring", granted: true, expect: await rowOn(OTHER, "pulse.hiring") }] },
  ];
  const dr = await call(S, "POST", "/api/access/admin/changes", { items: batch, dryRun: true });
  check("dry run: 2 people, 4 changes, gains/loses listed", dr.status === 200 && dr.json.people.length === 2 && dr.json.people.reduce((n, p) => n + p.changes.length, 0) === 4 && Array.isArray(dr.json.people[0].gains));
  check("dry run wrote nothing", (await fpNow()) === start.fp);
  const sv = await call(S, "POST", "/api/access/admin/changes", { items: batch, note: "m3 test batch" });
  const rows = sv.json?.changeId ? await Q(`select "targetUserId" from "AccessAudit" where "changeId"=$1`, [sv.json.changeId]) : [];
  check("batch save: one change id for 4 changes over 2 people", sv.status === 200 && sv.json.count === 4 && rows.length === 4 && new Set(rows.map((r) => r.targetUserId)).size === 2);
  const au = await call(S, "GET", `/api/access/admin/audit?person=${AMINO}`);
  const top = au.json?.changes?.[0];
  check("audit: newest first, batch shown with names and note", top?.changeId === sv.json.changeId && top.note === "m3 test batch" && top.by === "shadew_" && top.rows.length === 4);
  const ids = (await Q(`select "discordId" from "User"`)).map((r) => r.discordId);
  check("audit payload has no raw Discord ids", !ids.some((d) => au.text.includes(d)));
  const stale = await call(S, "POST", "/api/access/admin/changes", { items: [{ userId: AMINO, changes: [{ grantId: "patreon", granted: before.a, expect: before.a }] }] });
  check("stale expect refused 409 with a plain reason", stale.status === 409 && /changed since you loaded the page/.test(stale.json.error));
  const un = await call(S, "POST", "/api/access/admin/revert", { changeId: sv.json.changeId });
  check("undo batch: one revert puts all 4 back", un.status === 200 && un.json.count === 4 && (await fpNow()) === start.fp);
  const un2 = await call(S, "POST", "/api/access/admin/revert", { changeId: sv.json.changeId });
  check("undo twice refused 409 'already reverted'", un2.status === 409 && un2.json.error === "already reverted");
  const au2 = await call(S, "GET", `/api/access/admin/audit?person=${AMINO}`);
  check("audit: undo listed, original marked undone", au2.json.changes[0].isUndo && au2.json.changes[1].undoneAt);
  check("unknown grant in a save refused 400, nothing written",
    (await call(S, "POST", "/api/access/admin/changes", { items: [{ userId: AMINO, changes: [{ grantId: "nope.x", granted: true, expect: false }] }] })).status === 400 && (await fpNow()) === start.fp);

  // ---- security review (25 Nov): CSRF, expect required, dry run shape ----
  const good = [{ userId: AMINO, changes: [{ grantId: "patreon", granted: !before.a, expect: before.a }] }];
  const fpC = await fpNow();
  const csrf = [
    await call(S, "POST", "/api/access/admin/changes", { items: good }, { origin: "https://evil.example" }),
    await call(S, "POST", "/api/access/admin/changes", { items: good }, { origin: null }),
    await call(S, "POST", "/api/access/admin/presets", { name: "m3 csrf", grantIds: [] }, { origin: "http://127.0.0.1:3901" }),
    await call(S, "POST", "/api/access/admin/admins", { userId: AMINO, on: true }, { origin: "https://evil.example" }),
    await call(S, "POST", "/api/access/admin/preview", { userId: AMINO, staged: {} }, { origin: "https://evil.example" }),
  ];
  check("write with wrong or missing Origin = 403 (changes, presets, admins, preview), nothing written",
    csrf.every((r) => r.status === 403 && /did not come from the Portal page/.test(r.json?.error ?? "")) && (await fpNow()) === fpC, csrf.map((r) => r.status).join(","));
  const plain = [
    await call(S, "POST", "/api/access/admin/changes", JSON.stringify({ items: good }), { type: "text/plain" }),
    await call(S, "POST", "/api/access/admin/changes", JSON.stringify({ items: good }), { type: null }),
    await call(S, "POST", "/api/access/admin/revert", JSON.stringify({ changeId: "x" }), { type: "application/x-www-form-urlencoded" }),
    await call(S, "DELETE", "/api/access/admin/presets/x", "{}", { type: "text/plain" }),
  ];
  check("write with text/plain, form or no Content-Type = 403, nothing written",
    plain.every((r) => r.status === 403 && /must be sent as JSON/.test(r.json?.error ?? "")) && (await fpNow()) === fpC, plain.map((r) => r.status).join(","));
  check("JSON with charset from the Portal origin still accepted (dry run 200)",
    (await call(S, "POST", "/api/access/admin/changes", { items: good, dryRun: true }, { type: "application/json; charset=utf-8" })).status === 200);
  const noExpect = [{ userId: AMINO, changes: [{ grantId: "patreon", granted: !before.a }] }];
  const ne1 = await call(S, "POST", "/api/access/admin/changes", { items: noExpect });
  const ne2 = await call(S, "POST", "/api/access/admin/changes", { items: noExpect, dryRun: true });
  check("change without expect = 400 (save and dry run), nothing written",
    ne1.status === 400 && /expect is required/.test(ne1.json?.error ?? "") && ne2.status === 400 && (await fpNow()) === fpC, `${ne1.status},${ne2.status}`);
  const bigList = Array.from({ length: 1001 }, (_, i) => ({ grantId: "patreon", granted: true, expect: false, i }));
  const malformed = [
    { items: "x" }, { items: [] }, { items: [null] }, { items: [{ userId: 5, changes: [] }] }, { items: [{ userId: AMINO, changes: [null] }] },
    { items: [{ userId: AMINO, changes: [{ grantId: "patreon", granted: "yes", expect: false }] }] },
    { items: [{ userId: AMINO, changes: [{ grantId: "patreon", granted: true, expect: "no" }] }] },
    { items: [{ userId: AMINO, changes: [{ grantId: "patreon", granted: true, expect: false }, { grantId: "patreon", granted: false, expect: false }] }] },
    { items: [{ userId: AMINO, changes: [{ grantId: "patreon", granted: true, expect: false }] }, { userId: AMINO, changes: [{ grantId: "pulse", granted: true, expect: false }] }] },
    { items: [{ userId: AMINO, changes: bigList }] },
  ];
  const md = [];
  for (const m of malformed) md.push(await call(H, "POST", "/api/access/admin/changes", { ...m, dryRun: true }));
  check(`malformed dry run = 400 (${malformed.length} shapes incl. >1000 changes), never 500, nothing written`,
    md.every((r) => r.status === 400) && (await fpNow()) === fpC, md.map((r) => r.status).join(","));

  // ---- access admins (owner only) ----
  const m1 = await call(S, "POST", "/api/access/admin/admins", { userId: ATOM, on: true, note: "m3 test" });
  check("owner makes atomboy7 access admin", m1.status === 200 && m1.json.changeId);
  const T2 = cookie("atomboy7");
  const ts = await call(T2, "GET", "/api/access/admin");
  check("access admin: state 200, can manage, page 200", ts.status === 200 && ts.json.viewer.can === "manage" && (await call(T2, "GET", "/access")).status === 200);
  check("access admin cannot name access admins (403)", (await call(T2, "POST", "/api/access/admin/admins", { userId: AMINO, on: true })).status === 403);
  check("access admin: owner and self are locked in the list", ts.json.people.find((p) => p.id === OWNER).lockedReason && ts.json.people.find((p) => p.id === ATOM).lockedReason);
  const mixed = [{ userId: AMINO, changes: [{ grantId: "patreon", granted: !before.a, expect: before.a }] }, { userId: OWNER, changes: [{ grantId: "patreon", granted: true, expect: await rowOn(OWNER, "patreon") }] }];
  const fpA = await fpNow();
  const mx = await call(T2, "POST", "/api/access/admin/changes", { items: mixed });
  check("access admin batch touching the owner refused 403, nothing written (all or nothing)", mx.status === 403 && (await fpNow()) === fpA, mx.json?.error ?? "");
  const ta = await call(T2, "POST", "/api/access/admin/changes", { items: [{ userId: AMINO, changes: [{ grantId: "patreon", granted: !before.a, expect: before.a }] }] });
  check("access admin saves a change (200)", ta.status === 200 && ta.json.changeId);
  check("access admin undoes it (200)", (await call(T2, "POST", "/api/access/admin/revert", { changeId: ta.json.changeId })).status === 200);
  check("access admin cannot undo an access admin change (403)", (await call(T2, "POST", "/api/access/admin/revert", { changeId: m1.json.changeId })).status === 403);
  check("owner removes the access admin", (await call(S, "POST", "/api/access/admin/admins", { userId: ATOM, on: false })).status === 200);
  check("atomboy7 back to 404", (await call(T2, "GET", "/api/access/admin")).status === 404);

  // ---- presets ----
  const fpBeforePresets = (await snapshot());
  const pc = await call(S, "POST", "/api/access/admin/presets", { name: "m3 test Hiring only", description: "test", grantIds: ["pulse", "pulse.hiring"] });
  check("preset create 200", pc.status === 200 && pc.json.id);
  check("preset duplicate name 409", (await call(S, "POST", "/api/access/admin/presets", { name: "m3 test Hiring only", grantIds: [] })).status === 409);
  check("preset unknown grant 400", (await call(S, "POST", "/api/access/admin/presets", { name: "m3 bad", grantIds: ["nope"] })).status === 400);
  const accessFp = async () => JSON.stringify([await Q(`select * from "AppAccess" order by id`), await Q(`select id,"isAdmin","isAccessAdmin" from "User" order by id`)]);
  const a0 = await accessFp();
  check("preset edit 200 and nobody's access changed", (await call(S, "PATCH", `/api/access/admin/presets/${pc.json.id}`, { name: "m3 test Hiring only", grantIds: ["pulse.hiring"] })).status === 200 && (await accessFp()) === a0 && (await accessFp()) === JSON.stringify([fpBeforePresets.access, fpBeforePresets.users]));
  const pl = await call(H, "GET", "/api/access/admin/presets");
  check("Portal admin sees the preset (read)", pl.json.presets.some((p) => p.id === pc.json.id && p.grantIds.join() === "pulse.hiring"));
  check("preset delete 200, then 404", (await call(S, "DELETE", `/api/access/admin/presets/${pc.json.id}`)).status === 200 && (await call(S, "DELETE", `/api/access/admin/presets/${pc.json.id}`)).status === 404);

  // ---- pre-grants: waiting for re-sign-in ----
  const aminoEmail = (await Q(`select email from "User" where id=$1`, [AMINO]))[0].email;
  await call(S, "POST", "/api/admin/pending-access", { email: aminoEmail, appId: "patreon", granted: true });
  await call(S, "POST", "/api/admin/pending-access", { email: "m3-nobody@example.test", appId: "pulse", granted: true });
  const pe = await call(S, "GET", "/api/access/admin/pending");
  const st = (e) => pe.json.pending.find((r) => r.email === e)?.status;
  check("pre-grant for a signed-in person: waiting for re-sign-in", st(aminoEmail) === "waiting for re-sign-in");
  check("pre-grant for an unknown email: waiting for first sign-in", st("m3-nobody@example.test") === "waiting for first sign-in");

  // ---- emails and Discord ids: owner only (security review 25 Nov) ----
  const secrets = [
    ...(await Q(`select "discordId" as v from "User"`)).map((r) => r.v).filter((v) => v && v.length >= 15),
    ...(await Q(`select email as v from "User" where email is not null union select email from "PendingAppAccess" union select "externalEmail" from "AppUserLink" where "externalEmail" is not null`)).map((r) => r.v).filter(Boolean),
  ];
  const leaks = (text) => secrets.filter((x) => text.includes(x)).length;
  const routes = ["/api/access/admin", "/api/access/admin/pending", "/api/access/admin/audit", "/access"];
  const ownerR = await Promise.all(routes.map((u) => call(S, "GET", u)));
  check("owner: full emails in pending + audit, avatar URLs with ids",
    pe.json.pending.some((r) => r.email === aminoEmail) && ownerR[2].text.includes("pre-grant for m3-nobody@example.test") && ownerR[0].json.people.some((p) => p.avatarUrl) && leaks(ownerR[0].text + ownerR[1].text) > 0);
  const mAccess = await call(S, "POST", "/api/access/admin/admins", { userId: ATOM, on: true, note: "m3 privacy test" });
  const T3 = cookie("atomboy7");
  for (const [who, c] of [["Portal admin", H], ["access admin", T3]]) {
    const rs = await Promise.all(routes.map((u) => call(c, "GET", u)));
    const n = rs.reduce((sum, r) => sum + leaks(r.text), 0);
    const pend = rs[1].json?.pending ?? [];
    check(`${who}: pending emails masked (a***@domain)`, rs[1].status === 200 && pend.length >= 2 && pend.every((r) => /^.\*\*\*@[^@]+$/.test(r.email)) && pend.some((r) => r.email === "m***@example.test"));
    check(`${who}: audit pre-grant label masked`, rs[2].status === 200 && rs[2].text.includes("pre-grant for m***@example.test"));
    check(`${who}: avatarUrl null for everyone`, rs[0].status === 200 && rs[0].json.people.every((p) => p.avatarUrl === null));
    check(`${who}: no Discord id or email anywhere in state/pending/audit/page`, n === 0, `${secrets.length} values checked, ${n} found`);
    // some User.id values are "portal_<discordId>": non-owners get an opaque u_ ref that every route accepts back
    const digitUser = (await Q(`select username from "User" where id ~ '[0-9]{15,}' order by username limit 1`))[0];
    const refP = digitUser ? rs[0].json.people.find((p) => p.username === digitUser.username) : null;
    check(`${who}: user id with a Discord id in it is an opaque ref; preview + audit filter accept it`, !digitUser || (refP?.id.startsWith("u_") &&
      (await call(c, "POST", "/api/access/admin/preview", { userId: refP.id, staged: { patreon: true } })).status === 200 &&
      (await call(c, "GET", `/api/access/admin/audit?person=${refP.id}`)).status === 200), digitUser ? "" : "no such user in this DB");
  }
  check("privacy test: access admin removed again", mAccess.status === 200 && (await call(S, "POST", "/api/access/admin/admins", { userId: ATOM, on: false })).status === 200);
  await call(S, "DELETE", "/api/admin/pending-access", { email: aminoEmail, appId: "patreon" });
  await call(S, "DELETE", "/api/admin/pending-access", { email: "m3-nobody@example.test", appId: "pulse" });
} catch (err) {
  check("no exception", false, String(err?.stack ?? err));
}

const end = await snapshot();
const same = end.fp === start.fp;
if (!same) {
  // restore the start state (portal_dev only): AppAccess rows, User flags, pre-grants
  const c = await db.connect();
  try {
    await c.query("begin");
    await c.query(`delete from "AppAccess"`);
    for (const r of start.access) {
      await c.query(`insert into "AppAccess"(id,"userId","appId",granted,"grantedAt","grantedBy") values($1,$2,$3,$4,$5,$6)`, [r.id, r.userId, r.appId, r.granted, r.grantedAt, r.grantedBy]);
    }
    for (const u of start.users) await c.query(`update "User" set "isAdmin"=$2,"isAccessAdmin"=$3 where id=$1`, [u.id, u.isAdmin, u.isAccessAdmin]);
    await c.query("commit");
  } catch (e) { await c.query("rollback"); console.error("restore failed", String(e)); } finally { c.release(); }
}
check("AppAccess + User flags + pre-grants + presets identical to the start", same, `${start.fp} / ${end.fp}${same ? "" : " (restored AppAccess + flags)"}`);
const failed = results.filter((r) => !r).length;
console.log(`${results.length - failed}/${results.length} passed`);
await db.end();
process.exit(failed ? 1 : 0);
