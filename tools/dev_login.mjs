#!/usr/bin/env node
// DEV ONLY: mint a Portal session cookie for a user in the dev DB, so the test copy can be used without Discord.
// It builds the same Auth.js session token the real Discord sign-in sets (auth.ts jwt callback claims),
// encrypted with this copy's AUTH_SECRET, the same way app/api/auth/desktop/poll does.
//
// Usage (from the repo dir, as the service user):  node tools/dev_login.mjs <username|discordId> [--header] [--verified]
// --verified sets emailVerified (Discord's "verified" flag) so pre-grants by email apply (lib/pendingAccess.ts).
// Prints the cookie as name=value (or a full "Cookie: ..." header with --header). Use it with curl -b or a browser.
//
// Refuses to run unless ALL of these hold, so it can never work against production:
//   DEV_LOGIN=1, AUTH_URL is http://127.0.0.1 or http://localhost, DATABASE_URL names the portal_dev database.
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import pg from "pg";
import { encode } from "next-auth/jwt";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: path.join(root, ".env"), quiet: true });

function refuse(why) {
  console.error(`dev_login: refused: ${why}`);
  process.exit(2);
}

const authUrl = process.env.AUTH_URL ?? "";
const dbUrl = process.env.DATABASE_URL ?? "";
if (process.env.DEV_LOGIN !== "1") refuse("DEV_LOGIN is not 1");
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?(\/|$)/.test(authUrl)) refuse("AUTH_URL is not a local http address");
if (!/\/portal_dev(\?|$)/.test(dbUrl)) refuse("DATABASE_URL is not the portal_dev database");
if (!process.env.AUTH_SECRET) refuse("AUTH_SECRET is empty");

const args = process.argv.slice(2);
const who = args.find((a) => !a.startsWith("--"));
if (!who) {
  console.error("usage: node tools/dev_login.mjs <username|discordId> [--header]");
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: dbUrl });
let user;
try {
  const { rows } = await pool.query(
    `SELECT "discordId", username, email, avatar FROM "User" WHERE username = $1 OR "discordId" = $1 LIMIT 2`,
    [who],
  );
  if (rows.length !== 1) refuse(rows.length ? `"${who}" matches more than one user` : `no user "${who}" in portal_dev`);
  user = rows[0];
} finally {
  await pool.end();
}

// Same cookie name Auth.js picks: __Secure- prefix only on https (lib/desktopSignin.ts sessionCookieName).
const name = authUrl.startsWith("https:") ? "__Secure-authjs.session-token" : "authjs.session-token";
const maxAge = 24 * 60 * 60; // dev cookies last 1 day (real ones: 365 days)
const token = await encode({
  secret: process.env.AUTH_SECRET,
  salt: name,
  maxAge,
  token: {
    name: user.username,
    email: user.email,
    picture: null,
    sub: user.discordId,
    discordId: user.discordId,
    avatar: user.avatar,
    username: user.username,
    globalName: user.username,
    isAdmin: user.discordId === process.env.ADMIN_DISCORD_ID,
    emailVerified: args.includes("--verified"),
  },
});

console.log(args.includes("--header") ? `Cookie: ${name}=${token}` : `${name}=${token}`);
