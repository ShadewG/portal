#!/usr/bin/env node
// B0 test members for Portal (hub decision 28 Nov 2026). Safe to run on production; does nothing to real people.
//
//   node --experimental-strip-types --no-warnings tools/test_users.mjs list
//   node --experimental-strip-types --no-warnings tools/test_users.mjs create [--apply]
//   node --experimental-strip-types --no-warnings tools/test_users.mjs mint <lead|reviewer|member> [--hours N] [--out DIR]
//   node --experimental-strip-types --no-warnings tools/test_users.mjs remove [--apply]
//
// Users (lib/testUsers.ts marker: username "TEST ..." AND discordId "test:..."; emails on the reserved .invalid domain):
//   TEST lead      test:lead      full Pulse grant
//   TEST reviewer  test:reviewer  pulse.hiring only
//   TEST member    test:member    no Pulse; the "Everyone" pack: Desk, Training, Invoicing
// create/remove: grants go through the audited lib code as the owner (one change id each run); users are created /
//   deleted in the same run (delete cascades their AppAccess rows). Dry run unless --apply.
// mint: ONLY for a user that carries both test markers. Reads AUTH_SECRET and AUTH_URL from the env file itself
//   (--env, default <repo>/.env), which must be mode 600 or stricter. Session lasts --hours (default 12, max 24);
//   auth.ts refuses it after that time. The cookie is written to <out>/<role>.cookie (dir 700, file 600, default
//   /root/portal-test-sessions) and never printed. Use: curl -b <file> (a Netscape cookie file) or a browser cookie.
import { registerHooks } from "node:module";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync, chmodSync } from "node:fs";
import { pathToFileURL, fileURLToPath } from "node:url";
import path from "node:path";
import pg from "pg";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const cmd = args[0];
const opt = (name, def) => (args.includes(name) ? args[args.indexOf(name) + 1] : def);
const apply = args.includes("--apply");
const die = (msg, code = 2) => { console.error(`test_users: ${msg}`); process.exit(code); };

export const TEST_USERS = [
  { role: "lead", id: "test-user-lead", discordId: "test:lead", username: "TEST lead", email: "test-1@example.invalid", grants: ["pulse"] },
  { role: "reviewer", id: "test-user-reviewer", discordId: "test:reviewer", username: "TEST reviewer", email: "test-2@example.invalid", grants: ["pulse.hiring"] },
  { role: "member", id: "test-user-member", discordId: "test:member", username: "TEST member", email: "test-3@example.invalid", grants: ["desk", "insanity-courses", "invoicing"] },
];
const NOTE = "B0 test users (hub decision 28 Nov 2026, R-3258)";

// ---- env: read the file itself, refuse a readable-by-others file ----
const envPath = path.resolve(opt("--env", path.join(root, ".env")));
let st;
try { st = statSync(envPath); } catch { die(`no env file at ${envPath}`); }
if ((st.mode & 0o077) !== 0) die(`env file ${envPath} is readable by group/others (mode ${(st.mode & 0o777).toString(8)}): refusing`);
const env = {};
for (const line of readFileSync(envPath, "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) env[m[1]] = m[2].replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1");
}
if (!env.DATABASE_URL) die("DATABASE_URL missing in the env file");

const { isTestUser, TEST_MAX_HOURS } = await import(pathToFileURL(path.join(root, "lib/testUsers.ts")).href);
for (const u of TEST_USERS) if (!isTestUser(u)) die(`internal: ${u.username} does not carry both test markers`);

const pool = new pg.Pool({ connectionString: env.DATABASE_URL });
const q = (sql, params) => pool.query(sql, params);

async function present() {
  const { rows } = await q(`SELECT id, "discordId", username FROM "User" WHERE "discordId" = ANY($1) OR id = ANY($2)`,
    [TEST_USERS.map((u) => u.discordId), TEST_USERS.map((u) => u.id)]);
  for (const r of rows) if (!isTestUser(r)) die(`a row with a test id is not a test user (${r.id}): refusing`);
  return rows;
}

async function lib() {
  if (!env.ADMIN_DISCORD_ID) die("ADMIN_DISCORD_ID missing in the env file");
  process.env.ADMIN_DISCORD_ID = env.ADMIN_DISCORD_ID;
  const { PrismaClient } = await import("@prisma/client");
  const { PrismaPg } = await import("@prisma/adapter-pg");
  globalThis.__tu = { prisma: new PrismaClient({ adapter: new PrismaPg(pool) }) };
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier === "@/lib/db") return { url: `data:text/javascript,${encodeURIComponent("export const prisma = globalThis.__tu.prisma;")}`, shortCircuit: true };
      if (specifier.startsWith("@/")) {
        const base = path.join(root, specifier.slice(2));
        return { url: pathToFileURL([".ts", ".tsx"].map((e) => base + e).find(existsSync)).href, shortCircuit: true };
      }
      return nextResolve(specifier, context);
    },
  });
  const C = await import(pathToFileURL(path.join(root, "lib/accessChanges.ts")).href);
  const { rows } = await q(`SELECT username FROM "User" WHERE "discordId" = $1`, [env.ADMIN_DISCORD_ID]);
  return { C, actor: { discordId: env.ADMIN_DISCORD_ID, username: rows[0]?.username ?? "owner" } };
}

let failed = false;
try {
  if (cmd === "list") {
    const rows = await present();
    for (const u of TEST_USERS) {
      const r = rows.find((x) => x.discordId === u.discordId);
      const g = r ? (await q(`SELECT "appId" FROM "AppAccess" WHERE "userId" = $1 AND granted ORDER BY 1`, [r.id])).rows.map((x) => x.appId) : [];
      console.log(`${u.username}: ${r ? `present, grants ${g.join(",") || "none"}` : "absent"}`);
    }
  } else if (cmd === "create") {
    const rows = await present();
    const missing = TEST_USERS.filter((u) => !rows.some((r) => r.discordId === u.discordId));
    for (const u of TEST_USERS) console.log(`${u.username}: ${missing.includes(u) ? (apply ? "creating" : "would create") : "exists"}; grants ${u.grants.join(",")}`);
    if (apply) {
      const { C, actor } = await lib();
      for (const u of missing) {
        await q(`INSERT INTO "User" (id, "discordId", username, email, "isAdmin", "createdAt", "updatedAt") VALUES ($1,$2,$3,$4,false,now(),now())`,
          [u.id, u.discordId, u.username, u.email]);
      }
      const items = [];
      // the row found by Discord id (a leftover row from before review S7 may carry another id than u.id)
      const now = await present();
      for (const u of TEST_USERS) {
        const userId = now.find((r) => r.discordId === u.discordId)?.id;
        if (!userId) die(`${u.username} is missing after create`, 1);
        const { rows: have } = await q(`SELECT "appId", granted FROM "AppAccess" WHERE "userId" = $1`, [userId]);
        const changes = u.grants.filter((g) => !have.some((h) => h.appId === g && h.granted))
          .map((g) => ({ grantId: g, granted: true, expect: false }));
        if (changes.length) items.push({ userId, changes });
      }
      if (items.length) {
        const r = await C.setGrantsMany(actor, items, NOTE);
        console.log(`grants: change ${r.changeId}`);
      } else console.log("grants: already in place");
    } else console.log("dry run: nothing written (add --apply)");
  } else if (cmd === "remove") {
    const rows = await present();
    console.log(`${rows.length} test users present: ${rows.map((r) => r.username).join(", ") || "none"}`);
    if (apply && rows.length) {
      const { C, actor } = await lib();
      const items = [];
      for (const r of rows) {
        const { rows: on } = await q(`SELECT "appId" FROM "AppAccess" WHERE "userId" = $1 AND granted`, [r.id]);
        if (on.length) items.push({ userId: r.id, changes: on.map((x) => ({ grantId: x.appId, granted: false, expect: true })) });
      }
      if (items.length) console.log(`grants off: change ${(await C.setGrantsMany(actor, items, `${NOTE}: cleanup`)).changeId}`);
      const del = await q(`DELETE FROM "User" WHERE id = ANY($1) AND username LIKE 'TEST %' AND "discordId" LIKE 'test:%'`, [rows.map((r) => r.id)]);
      console.log(`deleted ${del.rowCount} test users (their AppAccess and AppUserLink rows went with them)`);
      console.log("now delete the minted cookie files (rm -rf the --out dir of mint, default /root/portal-test-sessions)");
    } else if (!apply) console.log("dry run: nothing written (add --apply)");
  } else if (cmd === "mint") {
    const role = args[1];
    const u = TEST_USERS.find((x) => x.role === role);
    if (!u) die("usage: mint <lead|reviewer|member> [--hours N] [--out DIR]", 1);
    const hours = Number(opt("--hours", "12"));
    if (!Number.isFinite(hours) || hours <= 0 || hours > TEST_MAX_HOURS) die(`--hours must be between 0 and ${TEST_MAX_HOURS}`);
    if (!env.AUTH_SECRET || !env.AUTH_URL) die("AUTH_SECRET or AUTH_URL missing in the env file");
    const { rows } = await q(`SELECT id, "discordId", username, email FROM "User" WHERE "discordId" = $1`, [u.discordId]);
    if (rows.length !== 1 || !isTestUser(rows[0])) die(`${u.username} is not present as a test user (run create first)`);
    const user = rows[0];
    const { encode } = await import("next-auth/jwt");
    const name = env.AUTH_URL.startsWith("https:") ? "__Secure-authjs.session-token" : "authjs.session-token";
    const maxAge = Math.round(hours * 3600);
    const token = await encode({
      secret: env.AUTH_SECRET, salt: name, maxAge,
      token: {
        name: user.username, email: user.email, picture: null, sub: user.discordId, discordId: user.discordId,
        avatar: null, username: user.username, globalName: user.username, isAdmin: false, emailVerified: false,
        testUntil: Math.floor(Date.now() / 1000) + maxAge,
      },
    });
    const out = path.resolve(opt("--out", "/root/portal-test-sessions"));
    mkdirSync(out, { recursive: true, mode: 0o700 });
    chmodSync(out, 0o700);
    const file = path.join(out, `${u.role}.cookie`);
    // curl -b <file> reads a Netscape cookie file; host-only cookie for the Portal host
    const host = new URL(env.AUTH_URL).hostname;
    const exp = Math.floor(Date.now() / 1000) + maxAge;
    writeFileSync(file, `# Netscape HTTP Cookie File\n${host}\tFALSE\t/\t${name.startsWith("__Secure-") ? "TRUE" : "FALSE"}\t${exp}\t${name}\t${token}\n`, { mode: 0o600 });
    chmodSync(file, 0o600);
    console.log(`minted ${u.username} for ${hours} h -> ${file} (600, not printed)`);
  } else {
    die("usage: list | create [--apply] | mint <role> [--hours N] [--out DIR] | remove [--apply]", 1);
  }
} catch (e) {
  failed = true;
  console.error(`test_users: ${e?.message ?? e}`);
} finally {
  await globalThis.__tu?.prisma?.$disconnect().catch(() => {});
  await pool.end().catch(() => {});
}
process.exit(failed ? 1 : 0);
