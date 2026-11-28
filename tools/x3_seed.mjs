#!/usr/bin/env node
// X3 seed (R-3258, Samuel's decisions of 28 Nov 2026). Writes through the audited lib code, as the owner:
//   1. access admins: Ayoub and Atom (lib/accessChanges.ts setAccessAdmin, one audited change each)
//   2. KPI grants for Ed and Chris (setGrantsMany, ONE change id for both)
// People are matched by Discord id AND username; any mismatch refuses everything. Already done = no-op.
//
//   cd <release dir> && node --experimental-strip-types --no-warnings tools/x3_seed.mjs            # dry run (default)
//   cd <release dir> && node --experimental-strip-types --no-warnings tools/x3_seed.mjs --apply    # write
//
// Reads DATABASE_URL and ADMIN_DISCORD_ID from the release .env. Prints usernames, grant ids and change ids only
// (no emails, no env values). Undo: /access audit log (Undo on each change) or tools/x3_seed.mjs --undo <changeId>.
import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
import { pathToFileURL, fileURLToPath } from "node:url";
import path from "node:path";
import dotenv from "dotenv";
import pg from "pg";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

export const ACCESS_ADMINS = [
  { discordId: "1033050881798709378", username: "ayoub_prods" },
  { discordId: "186424377993068544", username: "atomboy7" },
];
export const GRANTS = [
  { discordId: "1518756884453003406", username: "ed044426", grantId: "kpi" },
  { discordId: "1518972859697991731", username: "chris_valentini", grantId: "kpi" },
];
const NOTE = "X3 seed: Samuel's decisions 28 Nov 2026 (R-3258)";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: path.join(root, ".env"), quiet: true });
const args = process.argv.slice(2);
const apply = args.includes("--apply");
const undoId = args.includes("--undo") ? args[args.indexOf("--undo") + 1] : null;
const owner = process.env.ADMIN_DISCORD_ID;
if (!owner || !process.env.DATABASE_URL) { console.error("x3_seed: refused: ADMIN_DISCORD_ID or DATABASE_URL missing in .env"); process.exit(2); }

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@/lib/db") return { url: `data:text/javascript,${encodeURIComponent("export const prisma = globalThis.__seed.prisma;")}`, shortCircuit: true };
    if (specifier.startsWith("@/")) {
      const base = path.join(root, specifier.slice(2));
      return { url: pathToFileURL([".ts", ".tsx"].map((e) => base + e).find(existsSync)).href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
globalThis.__seed = { prisma };
const C = await import(pathToFileURL(path.join(root, "lib/accessChanges.ts")).href);
const G = await import(pathToFileURL(path.join(root, "lib/grants.ts")).href);

const ownerRow = await prisma.user.findUnique({ where: { discordId: owner }, select: { username: true } });
const actor = { discordId: owner, username: ownerRow?.username ?? "owner" };
let failed = false;
try {
  if (undoId) {
    const r = await C.revertChange(actor, undoId, `undo ${NOTE}`);
    console.log(`undone ${undoId} -> new change ${r.changeId} (${r.applied.length} rows)`);
  } else {
    const people = new Map();
    for (const p of [...ACCESS_ADMINS, ...GRANTS]) {
      const u = await prisma.user.findUnique({ where: { discordId: p.discordId }, include: { access: true } });
      if (!u) throw new Error(`no Portal user with the Discord id for ${p.username}`);
      if (u.username !== p.username) throw new Error(`Discord id for ${p.username} belongs to ${u.username}: refusing`);
      people.set(p.discordId, u);
    }
    for (const g of GRANTS) if (!G.isKnownGrant(g.grantId)) throw new Error(`grant ${g.grantId} is not in this release's catalog`);

    for (const a of ACCESS_ADMINS) {
      const u = people.get(a.discordId);
      if (u.isAccessAdmin) { console.log(`access admin ${a.username}: already on`); continue; }
      if (!apply) { console.log(`access admin ${a.username}: would turn on`); continue; }
      const r = await C.setAccessAdmin(actor, u.id, true, NOTE);
      console.log(`access admin ${a.username}: on (change ${r.changeId})`);
    }

    const items = [];
    for (const g of GRANTS) {
      const u = people.get(g.discordId);
      const row = u.access.find((x) => x.appId === g.grantId);
      if (row?.granted) { console.log(`grant ${g.grantId} for ${g.username}: already on`); continue; }
      console.log(`grant ${g.grantId} for ${g.username}: ${apply ? "turning on" : "would turn on"}`);
      items.push({ userId: u.id, changes: [{ grantId: g.grantId, granted: true, expect: row?.granted === true }] });
    }
    if (apply && items.length) {
      const r = await C.setGrantsMany(actor, items, NOTE);
      console.log(`grants: change ${r.changeId} (${r.people.reduce((n, p) => n + p.applied.length, 0)} rows)`);
    }
    if (!apply) console.log("dry run: nothing written (add --apply)");
  }
} catch (e) {
  failed = true;
  console.error(`x3_seed: ${e?.message ?? e}`);
} finally {
  await prisma.$disconnect();
  await pool.end();
}
process.exit(failed ? 1 : 0);
