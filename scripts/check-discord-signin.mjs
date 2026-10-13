// Regression check for the Discord "unexpected iss" sign-in failures (plan item 1.10, Oct 2026).
// Runs the real auth.ts route handlers in plain Node. Discord's token and user endpoints are faked
// in-process, so nothing goes over the network, no database is touched and no real secret is used.
//
//   node --experimental-strip-types --no-warnings scripts/check-discord-signin.mjs [auth.ts path]
//
// Exit 0 when: a callback carrying Discord's iss signs in, a callback without iss (Discord before
// Oct 2026) signs in, and a callback with a foreign iss is still refused.
import { registerHooks } from "node:module";
import { randomBytes } from "node:crypto";
import { pathToFileURL } from "node:url";
import path from "node:path";

// next-auth imports "next/server" and "next/headers" without an extension, which only a bundler resolves.
registerHooks({
  resolve(specifier, context, nextResolve) {
    return nextResolve(/^next\/[a-z-]+$/.test(specifier) ? `${specifier}.js` : specifier, context);
  },
});

// Test values only, set before auth.ts reads the environment.
for (const k of Object.keys(process.env)) if (k.startsWith("AUTH_") || k.startsWith("NEXTAUTH_")) delete process.env[k];
process.env.AUTH_SECRET = randomBytes(32).toString("hex");
process.env.AUTH_URL = "http://localhost:3002";
process.env.AUTH_DISCORD_ID = "check-client-id";
process.env.AUTH_DISCORD_SECRET = "check-client-secret";

const DISCORD_ISS = "https://discord.com";
const seen = [];
globalThis.fetch = async (input) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  seen.push(url);
  if (url === "https://discord.com/api/oauth2/token") {
    return Response.json({ access_token: "check-access", token_type: "Bearer", expires_in: 604800, refresh_token: "check-refresh", scope: "identify email" });
  }
  if (url === "https://discord.com/api/users/@me") {
    return Response.json({ id: "100000000000000001", username: "check", global_name: "Check", avatar: null, discriminator: "0", email: "check@example.invalid" });
  }
  throw new Error(`unexpected network call: ${url}`);
};

const authPath = path.resolve(process.argv[2] ?? new URL("../auth.ts", import.meta.url).pathname);
const { handlers } = await import(pathToFileURL(authPath).href);
const { NextRequest } = await import("next/server");
const BASE = "http://localhost:3002/api/auth";

async function call(method, url, jar, form) {
  const headers = new Headers();
  const cookie = Object.entries(jar).filter(([, v]) => v).map(([k, v]) => `${k}=${v}`).join("; ");
  if (cookie) headers.set("cookie", cookie);
  let body;
  if (form) {
    headers.set("content-type", "application/x-www-form-urlencoded");
    body = new URLSearchParams(form).toString();
  }
  const res = await handlers[method](new NextRequest(url, { method, headers, body }));
  for (const c of res.headers.getSetCookie()) {
    const pair = c.split(";")[0];
    const i = pair.indexOf("=");
    jar[pair.slice(0, i)] = pair.slice(i + 1);
  }
  return res;
}

// csrf -> POST signin/discord -> Discord would redirect back -> GET callback/discord?code=...
async function signIn(extraParams) {
  const jar = {};
  const logged = [];
  const { error, warn } = console;
  console.error = console.warn = (...args) => logged.push(args.map(String).join(" "));
  try {
    const { csrfToken } = await (await call("GET", `${BASE}/csrf`, jar)).json();
    const start = await call("POST", `${BASE}/signin/discord`, jar, { csrfToken, callbackUrl: "/" });
    const authorize = new URL(start.headers.get("location"));
    if (authorize.origin !== "https://discord.com") throw new Error(`sign-in did not go to Discord: ${authorize}`);
    const q = new URLSearchParams({ code: "check-code", ...extraParams });
    if (authorize.searchParams.get("state")) q.set("state", authorize.searchParams.get("state"));
    const res = await call("GET", `${BASE}/callback/discord?${q}`, jar);
    const signedIn = Object.entries(jar).some(([k, v]) => k.endsWith("authjs.session-token") && v);
    return { signedIn, location: res.headers.get("location"), issError: logged.some((l) => l.includes('unexpected "iss"')) };
  } finally {
    console.error = error;
    console.warn = warn;
  }
}

const cases = [
  { name: `callback with iss=${DISCORD_ISS} (Discord since Oct 2026)`, params: { iss: DISCORD_ISS }, want: true },
  { name: "callback without iss (Discord before Oct 2026)", params: {}, want: true },
  { name: "callback with a foreign iss (mix-up attack)", params: { iss: "https://evil.example" }, want: false },
];

console.log(`auth config: ${authPath}`);
let failed = 0;
for (const c of cases) {
  const r = await signIn(c.params);
  const ok = r.signedIn === c.want;
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${c.name}: ${r.signedIn ? "signed in" : "refused"}${r.issError ? ' (logged: unexpected "iss")' : ""} -> ${r.location}`);
}
const offline = seen.every((u) => u.startsWith("https://discord.com/api/"));
console.log(`network calls faked: ${seen.length}, all to Discord test doubles: ${offline}`);
process.exit(failed || !offline ? 1 : 0);
