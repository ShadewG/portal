// Self-contained route contract test. All farm calls are mocked; never creates real cards.
import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
import { pathToFileURL, fileURLToPath } from "node:url";
import path from "node:path";
import assert from "node:assert/strict";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === "@/lib/renderfarm") return { url: `data:text/javascript,${encodeURIComponent(`
    export const farmRequest = async (...args) => { globalThis.__mgxCalls.push(args); return globalThis.__mgxResult; };
    export const farmJson = r => Response.json(r.body, {status:r.status, headers:{'Cache-Control':'no-store'}});
  `)}`, shortCircuit: true };
  if (specifier.startsWith("@/")) {
    const file = path.join(root, specifier.slice(2) + ".ts");
    assert(existsSync(file), `missing ${file}`);
    return { url: pathToFileURL(file).href, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}});
const { POST } = await import(pathToFileURL(path.join(root, "app/api/renderfarm/mgx/route.ts")).href);
const key = "mockEditorKey_".repeat(4);
process.env.RENDERFARM_QUEUE_KEYS = `alice:${key},bob:${"bobEditorKey_".repeat(4)}`;
const PATH = "/Insanity/Video/IB57/example.aep";
const request = (body, authorization = `Bearer ${key}`, contentType = "application/json") => new Request("http://localhost/api/renderfarm/mgx", {
  method: "POST", headers: { authorization, "Content-Type": contentType }, body: typeof body === "string" ? body : JSON.stringify(body),
});
let passed = 0;
async function check(label, body, status, upstream, expected = null, auth, type) {
  globalThis.__mgxCalls = [];
  globalThis.__mgxResult = upstream || { status: 200, body: { result: "created" } };
  const response = await POST(request(body, auth, type));
  assert.equal(response.status, status, label);
  assert.equal(response.headers.get("Cache-Control"), "no-store", label);
  const actual = await response.json();
  if (expected) assert.deepEqual(actual, expected, label);
  if (upstream && status === upstream.status) {
    assert.equal(globalThis.__mgxCalls.length, 1, label);
    assert.equal(globalThis.__mgxCalls[0][0], "POST");
    assert.equal(globalThis.__mgxCalls[0][1], "/api/portal/mgx");
    assert.equal(globalThis.__mgxCalls[0][2], "alice");
    assert(globalThis.__mgxCalls[0][4] >= 90_000);
  } else assert.equal(globalThis.__mgxCalls.length, 0, label);
  console.log(`PASS ${label}: ${status}`);
  passed++;
}
for (const [name, status, result] of [
  ["new", 200, { card: { pageId: "mock" }, result: "created" }],
  ["existing", 200, { card: { pageId: "mock" }, result: "existing" }],
  ["empty path", 400, { error: "bad-request" }],
  ["conflict", 409, { error: "conflict", message: "mock conflict" }],
  ["ambiguity", 409, { error: "ambiguous", message: "mock ambiguous" }],
  ["missing board", 404, { error: "no-board" }],
  ["unavailable", 502, { error: "Render farm unreachable: timed out" }],
]) await check(name, { path: PATH, filename: "example.aep", project: "IB57" }, status, { status, body: result }, result);
await check("optional filename and project", { path: PATH }, 200, { status: 200, body: { ok: true } }, { ok: true });
assert.deepEqual(globalThis.__mgxCalls[0][3], { path: PATH, filename: "example.aep", editor: "alice" });
await check("missing auth", { path: PATH }, 401, null, { error: "Unauthorized" }, "");
await check("foreign auth", { path: PATH }, 401, null, { error: "Unauthorized" }, "Bearer " + "wrongKey_".repeat(4));
await check("empty client path", { path: "" }, 400);
await check("wrong filename", { path: PATH, filename: "other.aep" }, 400);
await check("path traversal", { path: "/Insanity/Video/../IB57/example.aep" }, 400);
await check("unknown editor field", { path: PATH, editor: "admin" }, 400);
await check("unknown secret field", { path: PATH, token: "mock" }, 400);
await check("invalid project", { path: PATH, project: "../../" }, 400);
await check("non JSON", { path: PATH }, 415, null, null, `Bearer ${key}`, "text/plain");
await check("malformed JSON", "{", 400);
const secret = "dummy_private_farm_credential";
process.env.RENDER_FARM_TOKEN = secret;
globalThis.__mgxCalls = [];
globalThis.__mgxResult = { status: 503, body: { error: `bad ${secret}` } };
const leak = await POST(request({ path: PATH }));
assert.equal(leak.status, 503);
assert(!JSON.stringify(await leak.json()).includes(secret));
console.log("PASS upstream credential redaction: 503"); passed++;
const otherKey = "bobEditorKey_".repeat(4);
globalThis.__mgxCalls = [];
globalThis.__mgxResult = { status: 200, body: { ok: true } };
await POST(request({ path: PATH, editor: undefined }, `Bearer ${otherKey}`));
assert.equal(globalThis.__mgxCalls[0][2], "bob");
assert.equal(globalThis.__mgxCalls[0][3].editor, "bob");
console.log("PASS server-held editor identity: bob"); passed++;
console.log(`${passed}/${passed} passed (mocked farm only)`);
