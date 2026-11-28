#!/usr/bin/env node
// DEV ONLY (X3 learn rule test): a stand-in for Discord's GET /guilds/{guild}/members/{id} on 127.0.0.1:3911, so the test
// copy (no bot token) can run lib/teamRule.ts. Who is who comes from portal_dev usernames:
//   --non-members a,b   -> 404 {"code":10007} (not on the server)
//   --error c,d         -> 500 (Discord down: Portal must say "try again")
//   everyone else       -> 200, a member with the Editor team role
// Logs one line per call (Discord id + answer) to stdout. Refuses unless DATABASE_URL names portal_dev.
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import pg from "pg";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: path.join(root, ".env"), quiet: true });
if (!/\/portal_dev(\?|$)/.test(process.env.DATABASE_URL ?? "")) { console.error("refused: DATABASE_URL is not portal_dev"); process.exit(2); }
const args = process.argv.slice(2);
const names = (k) => (args.includes(k) ? args[args.indexOf(k) + 1].split(",") : []);
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const ids = async (list) => new Set((await db.query(`select "discordId" from "User" where username = any($1)`, [list])).rows.map((r) => r.discordId));
const nonMember = await ids(names("--non-members"));
const error = await ids(names("--error"));
await db.end();
http.createServer((req, res) => {
  const id = req.url.match(/^\/guilds\/\d+\/members\/(\d+)$/)?.[1];
  let status = 200, body = { roles: ["1536130288504152206"], user: { username: "member" } };
  if (!id) { status = 404; body = { code: 0 }; }
  else if (error.has(id)) { status = 500; body = {}; }
  else if (nonMember.has(id)) { status = 404; body = { code: 10007 }; }
  console.log(`${new Date().toISOString()} ${id ?? req.url} ${status}`);
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}).listen(3911, "127.0.0.1", () => console.log(`stub on 127.0.0.1:3911 (non-members ${nonMember.size}, error ${error.size})`));
