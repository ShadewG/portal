// node --experimental-strip-types scripts/check-team-access.mjs — the Desk team rule (lib/teamRule.ts, 2 Nov 2026):
// who counts as the team, and that a Discord answer it cannot read never changes anyone's access. A fake fetch; no
// network, no database.
import assert from "node:assert/strict";
import { isTeamMember, memberName, teamMember, TEAM_ROLES, TEAM_GUILD_ID } from "../lib/teamRule.ts";

let passed = 0;
const ok = (name) => { passed++; if (process.env.VERBOSE) console.log(`ok - ${name}`); };
const JUNIOR = "1275562167269068800", EDITOR = "1536130288504152206", FOIA = "1518949744301445170";
const DUBBERS = "1365331973576458241", CAPTIONER = "1354249066430730402", PATREON = "1440731030620475620", BOOSTER = "1278828273320853535";

// the rule
assert.equal(isTeamMember({ roles: [JUNIOR], user: {} }), true);
assert.equal(isTeamMember({ roles: [PATREON, EDITOR], user: {} }), true);
assert.equal(isTeamMember({ roles: [FOIA], user: {} }), true);
ok("a team role lets them in");
assert.equal(isTeamMember({ roles: [DUBBERS, CAPTIONER], user: {} }), false);
assert.equal(isTeamMember({ roles: [PATREON, BOOSTER], user: {} }), false);
assert.equal(isTeamMember({ roles: [], user: {} }), false);
assert.equal(isTeamMember({ user: {} }), false);
assert.equal(isTeamMember(null), false);
ok("guests, dubbing contractors, supporters and no roles stay out");
assert.equal(isTeamMember({ roles: [JUNIOR, EDITOR], user: { bot: true } }), false);
ok("a bot never counts");
assert.equal(TEAM_GUILD_ID, "1275557298307203123");
assert.equal(Object.keys(TEAM_ROLES).length, 17);
assert.ok(!(DUBBERS in TEAM_ROLES) && !(CAPTIONER in TEAM_ROLES) && !("1275557298307203123" in TEAM_ROLES), "@everyone is not a team role");
ok("the role list is the written one");

assert.equal(memberName({ nick: "Marc (Marquee)", user: { global_name: "Marc", username: "marqueeru01" } }), "Marc (Marquee)");
assert.equal(memberName({ nick: null, user: { global_name: "Davin", username: "xasvidaniya" } }), "Davin");
assert.equal(memberName({ user: { username: "curlysyn" } }), "curlysyn");
assert.equal(memberName({ user: {} }), null);
ok("the name is the server nickname, else the display name");

// asking Discord
process.env.DISCORD_TEAM_BOT_TOKEN = "test-token";
const reply = (status, body) => async (url, init) => {
  assert.match(String(url), /^https:\/\/discord\.com\/api\/v10\/guilds\/1275557298307203123\/members\/\d+$/);
  assert.equal(init.headers.Authorization, "Bot test-token");
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
};
let t = 1_000_000;
const id = () => String(100000000000000000n + BigInt(++t));
const HASH = "0123456789abcdef0123456789abcdef";
assert.deepEqual(await teamMember(id(), reply(200, { roles: [EDITOR], nick: "Kea", user: { username: "k3aloha", avatar: HASH } }), t), { known: true, member: true, team: true, name: "Kea", avatar: HASH });
assert.deepEqual(await teamMember(id(), reply(200, { roles: [DUBBERS], user: { username: "x", avatar: "../evil" } }), t), { known: true, member: true, team: false, name: "x", avatar: null });
ok("the current Discord picture comes back with the answer (a hash only)");
ok("a member with and without a team role");
assert.deepEqual(await teamMember(id(), reply(404, { message: "Unknown Member", code: 10007 }), t), { known: true, member: false, team: false, name: null });
ok("not on the server: not the team");
assert.deepEqual(await teamMember(id(), reply(404, { message: "Unknown Guild", code: 10004 }), t), { known: false });
assert.deepEqual(await teamMember(id(), reply(429, { retry_after: 1 }), t), { known: false });
assert.deepEqual(await teamMember(id(), reply(500, {}), t), { known: false });
assert.deepEqual(await teamMember(id(), async () => { throw new Error("timeout"); }, t), { known: false });
ok("an answer that is not about the person (bot removed, rate limit, outage) decides nothing");
assert.deepEqual(await teamMember("demo-tutorial", reply(200, {}), t), { known: false });
assert.deepEqual(await teamMember("qa-detect-x", reply(200, {}), t), { known: false });
ok("demo and QA identities are never looked up");

// a known answer is kept five minutes, then asked again
const someone = id();
let calls = 0;
const counting = (roles) => async () => { calls++; return new Response(JSON.stringify({ roles, user: { username: "u" } }), { status: 200 }); };
await teamMember(someone, counting([JUNIOR]), t);
assert.equal((await teamMember(someone, counting([]), t + 60_000)).team, true);
assert.equal(calls, 1);
assert.equal((await teamMember(someone, counting([]), t + 5 * 60_000 + 1)).team, false);
assert.equal(calls, 2);
ok("five-minute memory, then the role taken away is seen");

// X4a: server member with no roles at all = member, not team; a bot is not a member
assert.deepEqual(await teamMember(id(), reply(200, { roles: [], user: { username: "m" } }), t), { known: true, member: true, team: false, name: "m", avatar: null });
assert.equal((await teamMember(id(), reply(200, { roles: [EDITOR], user: { bot: true, username: "b" } }), t)).member, false);
ok("member flag: on the server with or without roles; bots are not members");

// DISCORD_API_BASE: only a loopback stub is honoured (test copy), anything else still goes to Discord
const seen = [];
const echo = async (url) => { seen.push(String(url)); return new Response(JSON.stringify({ roles: [] }), { status: 200 }); };
process.env.DISCORD_API_BASE = "https://evil.example";
await teamMember(id(), echo, t);
process.env.DISCORD_API_BASE = "http://127.0.0.1:3911";
await teamMember(id(), echo, t);
delete process.env.DISCORD_API_BASE;
assert.match(seen[0], /^https:\/\/discord\.com\/api\/v10\//);
assert.match(seen[1], /^http:\/\/127\.0\.0\.1:3911\/guilds\//);
ok("API base override: loopback only");

delete process.env.DISCORD_TEAM_BOT_TOKEN;
assert.deepEqual(await teamMember(id(), reply(200, { roles: [EDITOR] }), t), { known: false });
ok("no token: nothing is decided");

console.log(`check-team-access: ${passed} passed`);
