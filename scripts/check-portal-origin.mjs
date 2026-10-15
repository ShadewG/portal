// Check for lib/portalOrigin.ts (15 Oct 2026): absolute links back into Portal never carry the bind
// address. `next start -H 0.0.0.0 -p 3002` gives a route handler the request URL
// https://0.0.0.0:3002/..., which /desk used to put in its redirect. Runs the real /desk and
// /api/auth/redirect routes in plain Node with the session and the database faked in-process.
//
//   node --experimental-strip-types --no-warnings scripts/check-portal-origin.mjs
import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
import { pathToFileURL, fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fakes = {
  "@/auth": "export const auth = async () => null;",
  "@/lib/db": "export const prisma = new Proxy({}, { get() { throw new Error('check: no database expected'); } });",
};
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (fakes[specifier]) return { url: `data:text/javascript,${encodeURIComponent(fakes[specifier])}`, shortCircuit: true };
    if (specifier.startsWith("@/")) {
      const base = path.join(root, specifier.slice(2));
      const file = [".ts", ".tsx"].map((ext) => base + ext).find(existsSync);
      return { url: pathToFileURL(file).href, shortCircuit: true };
    }
    return nextResolve(/^next\/[a-z-]+$/.test(specifier) ? `${specifier}.js` : specifier, context);
  },
});

const { GET: deskGET } = await import(pathToFileURL(path.join(root, "app/desk/route.ts")).href);
const { GET: handoffGET } = await import(pathToFileURL(path.join(root, "app/api/auth/redirect/route.ts")).href);
const { NextRequest } = await import("next/server");

const CADDY = { "x-forwarded-proto": "https", "x-forwarded-host": "portal.insanity.team" };
// What Next hands a route handler behind Caddy: the bind address, https from x-forwarded-proto.
const bound = (p, headers = {}) => new NextRequest(`https://0.0.0.0:3002${p}`, { headers });

const results = [];
const check = (name, ok, detail = "") => results.push({ name, ok: Boolean(ok), detail });
const location = (res) => res.headers.get("location") ?? "";

process.env.AUTH_URL = "https://portal.insanity.team";
let res = await deskGET(bound("/desk", CADDY));
check("/desk behind Caddy -> public handoff", res.status === 302 && location(res) === "https://portal.insanity.team/api/auth/redirect?app=desk", `${res.status} ${location(res)}`);
res = await deskGET(bound("/desk"));
check("/desk without forwarded headers -> AUTH_URL handoff", location(res) === "https://portal.insanity.team/api/auth/redirect?app=desk", location(res));
res = await handoffGET(bound("/api/auth/redirect?app=desk", CADDY));
check("signed-out handoff behind Caddy -> public /login", location(res) === "https://portal.insanity.team/login?callbackUrl=%2Fapi%2Fauth%2Fredirect%3Fapp%3Ddesk", location(res));
res = await handoffGET(bound("/api/auth/redirect?app=desk"));
check("signed-out handoff direct -> AUTH_URL /login", location(res).startsWith("https://portal.insanity.team/login?"), location(res));
res = await deskGET(bound("/desk?legacy=1", CADDY));
check("/desk?legacy=1 keeps the old review-desk page (signed out: 401)", res.status === 401 && !location(res), `${res.status}`);

process.env.AUTH_URL = "https://portal.example.test/some/path";
res = await deskGET(bound("/desk"));
check("AUTH_URL with a path -> origin only", location(res) === "https://portal.example.test/api/auth/redirect?app=desk", location(res));

delete process.env.AUTH_URL;
res = await deskGET(new NextRequest("http://localhost:3000/desk"));
check("next dev without AUTH_URL -> its own localhost origin", location(res) === "http://localhost:3000/api/auth/redirect?app=desk", location(res));

let failed = 0;
for (const r of results) {
  if (!r.ok) failed++;
  console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}${r.detail ? `  (${r.detail})` : ""}`);
}
process.exit(failed ? 1 : 0);
