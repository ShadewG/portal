#!/usr/bin/env node
// DEV ONLY (R-2159 M4). Server-to-server check GET/POST /api/access/check/server vs the cookie form
// /api/access/check, in-process, for every user in portal_dev and every catalog grant (+ unknown ids), plus the
// secret handling. Database read only (writes are blocked and counted, expected 0). Refuses unless DATABASE_URL
// names portal_dev. Prints usernames and grant ids only; the test secret is random per run and never printed.
//   cd /opt/access-dev/portal && node --experimental-strip-types --no-warnings tools/m4_server_check_test.mjs
import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { pathToFileURL, fileURLToPath } from "node:url";
import path from "node:path";
import dotenv from "dotenv";
import pg from "pg";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: path.join(root, ".env"), quiet: true });
if (!/\/portal_dev(\?|$)/.test(process.env.DATABASE_URL ?? "")) { console.error("refused: DATABASE_URL is not portal_dev"); process.exit(2); }
const fakes = {
  "@/auth": "export const auth = async () => globalThis.__t.session;",
  "@/lib/db": "export const prisma = new Proxy({}, { get: (_, k) => globalThis.__t.prisma[k] });",
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
const real = new PrismaClient({ adapter: new PrismaPg(new pg.Pool({ connectionString: process.env.DATABASE_URL })) });
const writes = [];
const READS = new Set(["findMany", "findUnique", "findFirst", "count"]);
const ro = new Proxy({}, {
  get(_, name) {
    if (name === "$transaction") return async () => { writes.push("$transaction"); return []; };
    if (typeof name !== "string" || name.startsWith("$")) return undefined;
    return new Proxy({}, { get: (_, op) => READS.has(op) ? (...a) => real[name][op](...a)
      : async () => { writes.push(`${name}.${String(op)}`); return null; } });
  },
});
globalThis.__t = { prisma: ro, session: null };

const SECRET = randomBytes(32).toString("hex");
process.env.PORTAL_ACCESS_CHECK_SECRET = SECRET;
const cookieGET = (await import(pathToFileURL(path.join(root, "app/api/access/check/route.ts")).href)).GET;
const server = await import(pathToFileURL(path.join(root, "app/api/access/check/server/route.ts")).href);
const { grantCatalog } = await import(pathToFileURL(path.join(root, "lib/grants.ts")).href);
const { NextRequest } = await import("next/server");
const U = "http://127.0.0.1:3900/api/access/check/server";
const sget = (grant, discordId, key = SECRET) => server.GET(new NextRequest(`${U}?grant=${encodeURIComponent(grant)}&discordId=${encodeURIComponent(discordId)}`,
  { headers: key === null ? {} : { "x-portal-access-key": key } }));
const spost = (body, key = SECRET) => server.POST(new NextRequest(U, { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body),
  headers: { "content-type": "application/json", ...(key === null ? {} : { "x-portal-access-key": key }) } }));

let pass = 0, fail = 0;
const ok = (cond, what) => { if (cond) pass++; else { fail++; console.log("FAIL", what); } };

const owner = process.env.ADMIN_DISCORD_ID;
const users = await real.user.findMany({ orderBy: { createdAt: "asc" }, select: { discordId: true, username: true } });
const grants = [...grantCatalog.map((g) => g.id), "nope.unknown", "pulse.hiring.extra", ""];
let compared = 0; let formatRefused = 0; const diffs = []; const hiring = [];
for (const u of users) {
  globalThis.__t.session = { user: { discordId: u.discordId, username: u.username, isAdmin: u.discordId === owner } };
  const batch = await (await spost({ discordId: u.discordId, grants: grants.slice(0, 16) })).json();
  const batch2 = await (await spost({ discordId: u.discordId, grants: grants.slice(16) })).json();
  const all = { ...batch.allowed, ...batch2.allowed };
  for (const g of grants) {
    const c = (await (await cookieGET(new NextRequest(`http://127.0.0.1:3900/api/access/check?grant=${encodeURIComponent(g)}`))).json()).allowed;
    const s = await sget(g, u.discordId); const sj = await s.json();
    compared++;
    if (!/^\d{15,22}$/.test(u.discordId ?? "")) {   // service rows (not Discord ids): the server form refuses by format
      formatRefused++;
      if (sj.allowed !== false || all[g] !== false) diffs.push(`${u.username} ${g}: non-Discord id answered true`);
      continue;
    }
    if (c !== sj.allowed || s.status !== 200 || Object.keys(sj).join() !== "allowed") diffs.push(`${u.username} ${g || "(empty)"}: cookie ${c} server GET ${sj.allowed} (${s.status})`);
    if (all[g] !== c) diffs.push(`${u.username} ${g || "(empty)"}: cookie ${c} server POST ${all[g]}`);
  }
  if ((await (await sget("pulse.hiring", u.discordId)).json()).allowed) hiring.push(u.username);
}
ok(diffs.length === 0, "server form == cookie form for every user x grant");
console.log(`users ${users.length}; grant answers compared ${compared - formatRefused} (GET and POST each); DIFFERENCES: ${diffs.length}`);
console.log(`non-Discord-id service rows (always false by format, cookie form cannot sign them in via Discord): ${users.filter((u) => !/^\d{15,22}$/.test(u.discordId ?? "")).map((u) => u.username).join(", ")} (${formatRefused} answers)`);
for (const d of diffs.slice(0, 20)) console.log("  ", d);
console.log(`pulse.hiring true for: ${hiring.join(", ") || "(nobody)"}`);

const shadew = users.find((u) => u.username === "shadew_");
const other = users.find((u) => u.username === "atomboy7") ?? users.find((u) => u.discordId !== owner);
ok(shadew && (await (await sget("pulse.hiring", shadew.discordId)).json()).allowed === true, "shadew_ pulse.hiring true");
ok(hiring.length === 1 && hiring[0] === "shadew_", "only shadew_ holds pulse.hiring in portal_dev");
ok((await (await sget("pulse.hiring", other.discordId)).json()).allowed === false, `${other.username} pulse.hiring false`);
ok((await (await sget("pulse", shadew.discordId)).json()).allowed === true, "shadew_ pulse true");
const wrong = await sget("pulse.hiring", shadew.discordId, SECRET.slice(0, -1) + (SECRET.endsWith("0") ? "1" : "0"));
ok(wrong.status === 401 && (await wrong.json()).allowed === false, "wrong secret 401 false");
const none = await sget("pulse.hiring", shadew.discordId, null);
ok(none.status === 401 && (await none.json()).allowed === false, "missing secret 401 false");
const empty = await sget("pulse.hiring", shadew.discordId, "");
ok(empty.status === 401, "empty secret 401");
const pw = await spost({ discordId: shadew.discordId, grants: ["pulse.hiring"] }, "x".repeat(64));
ok(pw.status === 401 && Object.keys((await pw.json()).allowed).length === 0, "POST wrong secret 401, no answers");
ok((await (await sget("nope.unknown", shadew.discordId)).json()).allowed === false, "unknown grant false (owner)");
ok((await (await sget("pulse.hiring", "999999999999999999")).json()).allowed === false, "unknown user false");
ok((await (await sget("pulse.hiring", "shadew_")).json()).allowed === false, "username instead of id false");
ok((await (await sget("pulse.hiring", "")).json()).allowed === false, "no discordId false");
const many = await spost({ discordId: shadew.discordId, grants: Array.from({ length: 17 }, (_, i) => "pulse" + i) });
ok(many.status === 400, "batch over 16 -> 400");
ok((await spost("{not json")).status === 400, "bad JSON -> 400");
const mixed = await (await spost({ discordId: shadew.discordId, grants: ["pulse.hiring", "nope", "pulse.servers"] })).json();
ok(mixed.allowed["pulse.hiring"] === true && mixed.allowed.nope === false && mixed.allowed["pulse.servers"] === true && Object.keys(mixed).join() === "allowed", "batch mixed answers, only booleans");
delete process.env.PORTAL_ACCESS_CHECK_SECRET;
const unset = await sget("pulse.hiring", shadew.discordId, SECRET);
ok(unset.status === 503 && (await unset.json()).allowed === false, "env unset: 503 false even with the old key");
process.env.PORTAL_ACCESS_CHECK_SECRET = "short";
ok((await sget("pulse.hiring", shadew.discordId, "short")).status === 503, "env too short (<32): 503, not configured");
process.env.PORTAL_ACCESS_CHECK_SECRET = SECRET;
globalThis.__t.prisma = new Proxy({}, { get: () => new Proxy({}, { get: () => async () => { throw new Error("db down"); } }) });
const down = await sget("pulse.hiring", shadew.discordId);
ok(down.status === 503 && (await down.json()).allowed === false, "DB error: 503 false");
ok(writes.length === 0, `writes blocked: ${writes.length} (${writes.join(",")})`);
console.log(`checks: ${pass} pass, ${fail} fail; writes ${writes.length}`);
await real.$disconnect();
process.exit(fail ? 1 : 0);
