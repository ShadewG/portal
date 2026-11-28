// X6 S5 unit test (R-3258): node --experimental-strip-types tools/x6_feedback_test.mjs   (no DB, fake fs)
import assert from "node:assert/strict";
import { createFeedback, cleanFeedbackText, cleanTab } from "../lib/feedback.ts";

let pass = 0;
const ok = async (name, fn) => { await fn(); pass++; console.log("ok", name); };
const fakeFs = () => { const files = {}; return { files, mkdir: async () => {}, appendFile: async (f, l, o) => { assert.equal(o.mode, 0o600); files[f] = (files[f] || "") + l; } }; };
const who = { discordId: "9001", username: "atomboy7", name: "Dominik" };

await ok("clean text", () => {
  assert.equal(cleanFeedbackText("  where\n\tis  it "), "where is it");
  assert.equal(cleanFeedbackText("ab"), null);
  assert.equal(cleanFeedbackText("x".repeat(301)), null);
  assert.equal(cleanFeedbackText("a‮b\u0007c"), "a b c");
  assert.equal(cleanFeedbackText(5), null);
});
await ok("clean tab", () => {
  assert.equal(cleanTab("People"), "People");
  assert.equal(cleanTab("<img src=x>"), null);
  assert.equal(cleanTab(null), null);
});
await ok("one line in the month file, person from the session", async () => {
  const fs = fakeFs(), f = createFeedback({ dir: "/fb", fs, now: () => new Date("2026-11-28T09:00:00Z") });
  const r = await f.take(who, { text: "Which toggle  gives Hiring?", page: "/access", tab: "People", who: { discordId: "1" } });
  assert.equal(r.status, 204);
  const line = JSON.parse(fs.files["/fb/portal-feedback-2026-11.jsonl"]);
  assert.deepEqual({ ...line, id: "x" }, { v: 1, id: "x", t: "2026-11-28T09:00:00.000Z", app: "portal", page: "/access", tab: "People", role: null,
    who: { portalUserId: null, discordId: "9001", username: "atomboy7", name: "Dominik" }, text: "Which toggle gives Hiring?" });
  await f.take(who, { text: "odd page", page: "/admin" });
  assert.equal(JSON.parse(fs.files["/fb/portal-feedback-2026-11.jsonl"].split("\n")[1]).page, "other");
});
await ok("400 / 401 / 503, nothing written", async () => {
  const fs = fakeFs();
  assert.equal((await createFeedback({ dir: "/fb", fs }).take(who, { text: "x" })).status, 400);
  assert.equal((await createFeedback({ dir: "/fb", fs }).take(null, { text: "hello" })).status, 401);
  assert.equal((await createFeedback({ dir: "", fs }).take(who, { text: "hello" })).status, 503);
  assert.deepEqual(fs.files, {});
});
await ok("rate limits", async () => {
  let t = Date.parse("2026-11-28T00:00:00Z"); const now = () => new Date(t);
  const f = createFeedback({ dir: "/fb", fs: fakeFs(), now });
  for (let i = 0; i < 5; i++) assert.equal((await f.take(who, { text: "note " + i })).status, 204);
  assert.equal((await f.take(who, { text: "sixth" })).status, 429);
  assert.equal((await f.take({ ...who, discordId: "9002" }, { text: "other" })).status, 204);
  for (let i = 0; i < 15; i++) { t += 601e3; assert.equal((await f.take(who, { text: "n" + i + "xx" })).status, 204); }
  t += 601e3; assert.equal((await f.take(who, { text: "21st" })).status, 429);
  const g = createFeedback({ dir: "/fb", fs: fakeFs(), now, allDay: 2 });
  assert.equal((await g.take({ ...who, discordId: "1" }, { text: "hello" })).status, 204);
  assert.equal((await g.take({ ...who, discordId: "2" }, { text: "hello" })).status, 204);
  assert.equal((await g.take({ ...who, discordId: "3" }, { text: "hello" })).status, 429);
});
await ok("failed write 503, not counted", async () => {
  const f = createFeedback({ dir: "/fb", log: () => {}, fs: { mkdir: async () => {}, appendFile: async () => { throw Object.assign(new Error("x"), { code: "EACCES" }); } } });
  for (let i = 0; i < 7; i++) assert.equal((await f.take(who, { text: "hello" })).status, 503);
});
console.log(`${pass}/6 pass`);
