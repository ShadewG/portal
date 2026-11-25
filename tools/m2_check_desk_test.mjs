#!/usr/bin/env node
// DEV ONLY (R-2159 M2 review fix 4): GET /api/access/check?grant=desk|desk.* runs the same Desk team sync as
// /api/auth/redirect?app=desk before it answers. Discord is stubbed (fake bot token + fake fetch, nothing leaves the
// box). Uses one user with an auto-managed Desk row, puts the row back exactly at the end.
//   cd /opt/access-dev/portal && node --experimental-strip-types --no-warnings tools/m2_check_desk_test.mjs
// Refuses unless DATABASE_URL names portal_dev. Prints usernames only.
import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
import { pathToFileURL, fileURLToPath } from "node:url";
import path from "node:path";
import dotenv from "dotenv";
import pg from "pg";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: path.join(root, ".env"), quiet: true });
if (!/\/portal_dev(\?|$)/.test(process.env.DATABASE_URL ?? "")) { console.error("refused: DATABASE_URL is not portal_dev"); process.exit(2); }
process.env.DISCORD_TEAM_BOT_TOKEN = "stub-not-a-token";
const fakes = {
  "@/auth": "export const auth = async () => globalThis.__t.session;",
  "@/lib/db": "export const prisma = globalThis.__t.prisma;",
};
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (fakes[specifier]) return { url: `data:text/javascript,${encodeURIComponent(fakes[specifier])}`, shortCircuit: true };
    if (specifier.startsWith("@/")) {
      const base = path.join(root, specifier.slice(2));
      return { url: pathToFileURL([".ts", ".tsx"].map((e) => base + e).find(existsSync)).href, shortCircuit: true };
    }
    return nextResolve(/^next\/[a-z-]+$/.test(specifier) ? `${specifier}.js` : specifier, context);
  },
});
const prisma = new PrismaClient({ adapter: new PrismaPg(new pg.Pool({ connectionString: process.env.DATABASE_URL })) });
globalThis.__t = { prisma, session: null };

let discordAnswer = null; let discordCalls = 0;
globalThis.fetch = async (url) => {
  if (!String(url).startsWith("https://discord.com/api/v10/guilds/")) throw new Error("unexpected fetch");
  discordCalls++;
  return discordAnswer;
};
const member = () => new Response(JSON.stringify({ roles: ["1536130288504152206"], nick: null, user: { username: "x" } }), { status: 200 });
const notMember = () => new Response(JSON.stringify({ code: 10007 }), { status: 404 });

const { GET } = await import(pathToFileURL(path.join(root, "app/api/access/check/route.ts")).href);
const { NextRequest } = await import("next/server");
const check = async (g) => (await (await GET(new NextRequest(`http://127.0.0.1:3900/api/access/check?grant=${g}`))).json()).allowed;

const results = [];
const ok = (name, cond) => { results.push(Boolean(cond)); console.log(`${cond ? "PASS" : "FAIL"} ${name}`); };
const owner = process.env.ADMIN_DISCORD_ID;
const row0 = await prisma.appAccess.findFirst({
  where: { appId: "desk", grantedBy: "auto:discord-team", granted: true, user: { isAdmin: false, discordId: { not: owner } } },
  include: { user: true },
});
if (!row0) { console.log("FAIL no auto Desk row to test with"); process.exit(1); }
console.log(`user ${row0.user.username} (auto Desk row, granted)`);
globalThis.__t.session = { user: { discordId: row0.user.discordId, username: row0.user.username } };
try {
  discordAnswer = notMember();
  ok("left the team: check desk answers false after the sync", (await check("desk")) === false);
  const off = await prisma.appAccess.findUnique({ where: { id: row0.id } });
  ok("sync turned the auto row off (grantedBy still auto)", off.granted === false && off.grantedBy === "auto:discord-team");
  discordAnswer = member();
  const realNow = Date.now; Date.now = () => realNow() + 6 * 60_000;   // past teamRule's 5-minute answer cache
  ok("back on the team: check desk.production syncs too (tab still not held, so false)", (await check("desk.production")) === false);
  const on = await prisma.appAccess.findUnique({ where: { id: row0.id } });
  ok("sync turned the auto row back on via desk.*", on.granted === true);
  const calls = discordCalls;
  ok("check pulse does not call the Desk sync", (await check("pulse")) !== undefined && discordCalls === calls);
} finally {
  await prisma.appAccess.update({ where: { id: row0.id }, data: { granted: row0.granted, grantedBy: row0.grantedBy, grantedAt: row0.grantedAt } });
}
const back = await prisma.appAccess.findUnique({ where: { id: row0.id } });
ok("row back exactly", back.granted === row0.granted && back.grantedBy === row0.grantedBy && +back.grantedAt === +row0.grantedAt);
const failed = results.filter((r) => !r).length;
console.log(`${results.length - failed}/${results.length} passed`);
await prisma.$disconnect();
process.exit(failed ? 1 : 0);
