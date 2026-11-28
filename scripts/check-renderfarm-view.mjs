// Check for the Render Farm page helpers (R-3254 step 1): one clock (B8), top line counts (S11),
// failed reasons and folded retry loops (S12). Plain Node, no network.
//
//   node --experimental-strip-types --no-warnings scripts/check-renderfarm-view.mjs [live.json jobs.json]
//
// With the two optional files (a read-only capture of /api/renderfarm/live and premiere ?op=jobs) it also prints
// the top line and the folded activity for that real data.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  collapseActivity, failedReason, farmCounts, fmtRange, fmtWhen, noticeText, notionHref, parseFarmTime, premiereLine, splitReason, topLine,
} from "../lib/renderfarmView.ts";

let n = 0;
const ok = (name, fn) => { fn(); n++; console.log(`ok ${n} ${name}`); };
const utc = (s) => Date.parse(s);

// B8: research C, 27 Nov 11:50 UTC: header generatedAt with Z, newest history line in Norway time without a zone.
ok("52-minute case: zone-less PC time is Oslo time, 8 min before the header, not 52 min after", () => {
  const gen = parseFarmTime("2026-11-27T11:50:22.000Z");
  const ev = parseFarmTime("2026-11-27T12:42:11");
  assert.equal(ev, utc("2026-11-27T11:42:11Z"));
  assert.equal(gen - ev, 8 * 60_000 + 11_000);
  assert.ok(Date.parse("2026-11-27T12:42:11Z") - gen === 51 * 60_000 + 49_000, "old reading was 52 min ahead");
});
ok("summer time (CEST, UTC+2)", () => assert.equal(parseFarmTime("2026-07-01T12:00:00"), utc("2026-07-01T10:00:00Z")));
ok("times with Z or an offset are kept as sent", () => {
  assert.equal(parseFarmTime("2026-11-27T11:50:22Z"), utc("2026-11-27T11:50:22Z"));
  assert.equal(parseFarmTime("2026-11-27T12:50:22+01:00"), utc("2026-11-27T11:50:22Z"));
  assert.equal(parseFarmTime("2026-11-27 12:42:11.250"), utc("2026-11-27T11:42:11.250Z"));
});
ok("spring DST edge, 29 Mar 2026 (02:00 -> 03:00 Oslo)", () => {
  assert.equal(parseFarmTime("2026-03-29T01:59:59"), utc("2026-03-29T00:59:59Z"));
  assert.equal(parseFarmTime("2026-03-29T03:00:00"), utc("2026-03-29T01:00:00Z"));
  assert.equal(parseFarmTime("2026-03-29T02:30:00"), utc("2026-03-29T01:30:00Z"), "a time that never existed moves one hour on");
});
ok("autumn DST edge, 25 Oct 2026 (03:00 -> 02:00 Oslo)", () => {
  assert.equal(parseFarmTime("2026-10-25T01:30:00"), utc("2026-10-24T23:30:00Z"));
  assert.equal(parseFarmTime("2026-10-25T02:30:00"), utc("2026-10-25T01:30:00Z"), "repeated hour reads as the winter one");
  assert.equal(parseFarmTime("2026-10-25T03:30:00"), utc("2026-10-25T02:30:00Z"));
});
ok("the zone the PC reports wins; a bad zone falls back to Oslo", () => {
  assert.equal(parseFarmTime("2026-11-27T12:42:11", "UTC"), utc("2026-11-27T12:42:11Z"));
  assert.equal(parseFarmTime("2026-11-27T12:42:11", "Not/AZone"), utc("2026-11-27T11:42:11Z"));
  assert.ok(Number.isNaN(parseFarmTime("")) && Number.isNaN(parseFarmTime("soon")));
});
ok("one format in the viewer's zone: '18:42' today, '27 Nov, 18:42' other days", () => {
  const ev = parseFarmTime("2026-11-27T12:42:11");
  const nowBkk = utc("2026-11-27T12:00:00Z");
  assert.equal(fmtWhen(ev, nowBkk, "Asia/Bangkok"), "18:42");
  assert.equal(fmtWhen(ev, utc("2026-11-28T05:00:00Z"), "Asia/Bangkok"), "27 Nov, 18:42");
  assert.equal(fmtWhen(parseFarmTime("2026-11-27T11:50:22Z"), nowBkk, "Asia/Bangkok"), "18:50", "header, same clock");
  assert.equal(fmtWhen(ev, nowBkk, "Europe/Oslo"), "12:42");
  assert.equal(fmtWhen(parseFarmTime("2026-09-03T00:05:00Z"), nowBkk, "UTC"), "3 Sep, 00:05");
  assert.equal(fmtWhen(NaN), "");
});
ok("same event, same time: PC zone-less line and the UTC line of the same moment", () => {
  const now = utc("2026-11-27T12:00:00Z");
  for (const z of ["Asia/Bangkok", "Europe/Oslo", "America/New_York"]) {
    assert.equal(fmtWhen(parseFarmTime("2026-11-27T12:42:11"), now, z), fmtWhen(parseFarmTime("2026-11-27T11:42:11Z"), now, z));
  }
});

// S12: research C, A_DOC-3 started and failed once a minute, 11:33-11:44 (Norway time), 22 of 30 lines.
const ev = (time, type, name = "A_DOC-3", detail = "") => ({ timestamp: `2026-11-27T${time}`, type, label: type, name, kind: "texted", episode: "IB90", detail });
const loop = [];
for (let m = 44; m >= 34; m--) {
  loop.push(ev(`11:${m}:30`, "FAIL", "A_DOC-3", "[texted] 'A_DOC-3' : no AEP Path and auto-find found nothing (searched /Insanity/Video/2 Ayoub_old/IB90 - X/3 After Effects PROJECTS) episode=IB90"));
  loop.push(ev(`11:${m - 1}:20`, "PICKUP"));
}
const history = [ev("11:50:00", "DONE", "B_PC_1.aep", "[texted] 'B_PC_1.aep' -> /Insanity/x.mp4 episode=IB90"), ...loop, ev("11:20:00", "FAIL", "M_PC-1", "[texted] 'M_PC-1' : comp not found episode=IB89"), ev("11:10:00", "PICKUP", "M_PC-1")];

ok("a retry loop folds into one line: 'A_DOC-3 failed 11 times, 11:33-11:44'", () => {
  const items = collapseActivity(history);
  assert.equal(items.length, 4);
  assert.ok("row" in items[0] && items[0].row.type === "DONE");
  const r = items[1].repeat;
  assert.equal(r.fails, 11);
  const now = utc("2026-11-27T12:00:00Z");
  const line = `${r.name} failed ${r.fails} times, ${fmtRange(parseFarmTime(r.from), parseFarmTime(r.to), now, "Europe/Oslo")}`;
  assert.equal(line, "A_DOC-3 failed 11 times, 11:33-11:44");
  assert.ok("row" in items[2] && items[2].row.name === "M_PC-1", "a single failure stays its own line");
});
ok("a finished render ends a run; two cards never fold together", () => {
  const h = [ev("12:03:00", "FAIL"), ev("12:02:00", "DONE"), ev("12:01:00", "FAIL"), ev("12:00:30", "FAIL", "OTHER"), ev("12:00:00", "FAIL")];
  assert.ok(collapseActivity(h).every((i) => "row" in i));
});
ok("fmtRange across days names both days", () => {
  assert.equal(fmtRange(utc("2026-11-26T23:50:00Z"), utc("2026-11-27T00:10:00Z"), utc("2026-11-28T00:00:00Z"), "UTC"), "26 Nov, 23:50-27 Nov, 00:10");
  assert.equal(fmtRange(utc("2026-11-25T10:00:00Z"), utc("2026-11-25T11:00:00Z"), utc("2026-11-28T00:00:00Z"), "UTC"), "25 Nov, 10:00-11:00");
});
ok("failed reason: no leading ':', no server path on the line, full text in details", () => {
  const s = splitReason(loop[0].detail);
  assert.equal(s.plain, "No AEP Path and auto-find found nothing");
  assert.ok(s.details.includes("/Insanity/Video") && !s.details.startsWith(":"));
  assert.deepEqual(splitReason("[texted] 'M_PC-1' : comp not found episode=IB89"), { plain: "Comp not found", details: "" });
  assert.equal(splitReason("C:\\RenderFarm\\x.aep missing").plain, "The render failed");
  assert.deepEqual(splitReason(""), { plain: "", details: "" });
  assert.deepEqual(splitReason("[texted] 'X' "), { plain: "", details: "" });
});
ok("a failed card with a blank reason takes its newest failure from the history, else none", () => {
  assert.equal(failedReason({ name: "A_DOC-3", kind: "texted", episode: "IB90", reason: "" }, history), loop[0].detail);
  assert.equal(failedReason({ name: "A_GEARTH-2", kind: "texted", episode: "IB90", reason: "" }, history), "");
  assert.equal(failedReason({ name: "A_DOC-3", kind: "texted", episode: "IB90", reason: "own reason" }, history), "own reason");
});

// S11: counts from both queues (Premiere states of the 28 Nov capture: 5 need a decision, 45 held, 10 done).
const jobs = [
  ...Array(5).fill({ title: "IB13 - MAIN.prproj", state: "needs_attention", held: false }),
  ...Array(37).fill({ title: "x.prproj", state: "needs_attention", held: true }),
  ...Array(5).fill({ title: "x.prproj", state: "planned", held: true }),
  ...Array(2).fill({ title: "x.prproj", state: "queued", held: true }),
  { title: "x.prproj", state: "ready", held: true },
  ...Array(8).fill({ title: "x.prproj", state: "cleaned", held: false }),
  ...Array(2).fill({ title: "x.prproj", state: "cleaned", held: true }),
];
ok("top line: held work is on hold, not 'in the queue'", () => {
  const c = farmCounts({ queue: [], failed: Array(15).fill({}) }, jobs);
  assert.deepEqual(c, { needDecision: 5, failed: 15, onHold: 45, nextUp: null });
  assert.equal(topLine(c), "5 need a decision · 15 failed · 45 on hold · next up: nothing");
});
ok("next up: After Effects card first, else the first free Premiere job; Premiere failures count", () => {
  const more = [{ title: "IB30 - FINAL.prproj", state: "queued", held: false }, { title: "IB31.prproj", state: "failed", held: false }, ...jobs];
  assert.equal(farmCounts({ queue: [{ name: "s_satmap_1" }], failed: [] }, more).nextUp, "s_satmap_1");
  const c = farmCounts({ queue: [], failed: [] }, more);
  assert.equal(c.nextUp, "IB30 - FINAL");
  assert.equal(c.failed, 1);
  assert.equal(topLine({ needDecision: 1, failed: 0, onHold: 0, nextUp: "X" }), "1 needs a decision · 0 failed · 0 on hold · next up: X");
  assert.deepEqual(farmCounts(null, []), { needDecision: 0, failed: 0, onHold: 0, nextUp: null });
});
ok("Premiere header says the same as the top line, not '50 in the queue'", () => {
  assert.equal(premiereLine(jobs), "5 need a decision · 45 on hold");
  assert.equal(premiereLine([{ title: "a", state: "queued", held: false }, { title: "b", state: "failed", held: false }]), "1 failed · 1 waiting");
  assert.equal(premiereLine([]), "nothing waiting");
});

// ---- Fix round 1 (Fable review E2/E3, 28 Nov)
const at = (time, type, name, episode, detail = "") => ({ timestamp: `2026-11-27T${time}`, type, label: type, name, kind: "texted", episode, detail });
ok("H1: a failed card never takes another episode's reason (A_PC_1 is in every episode)", () => {
  const h = [at("12:00:00", "FAIL", "A_PC_1", "IB60", "[texted] 'A_PC_1' : Dropbox down episode=IB60")];
  assert.equal(failedReason({ name: "A_PC_1", kind: "texted", episode: "IB59", reason: "" }, h), "");
  assert.equal(failedReason({ name: "A_PC_1", kind: "texted", episode: "IB60", reason: "" }, h), h[0].detail);
});
ok("M1: failures of two episodes' same-name cards never fold together", () => {
  const h = [at("12:02:00", "FAIL", "A_PC_1", "IB60", "[texted] 'A_PC_1' : Dropbox down"), at("12:01:00", "FAIL", "A_PC_1", "IB59", "[texted] 'A_PC_1' : Font missing: Inter")];
  const items = collapseActivity(h);
  assert.equal(items.length, 2);
  assert.ok(items.every((i) => "row" in i));
});
ok("M1: a fold keeps every distinct reason (newest shown, the others once with their count)", () => {
  const h = [
    at("12:05:00", "FAIL", "X", "IB59", "[texted] 'X' : AE crashed"), at("12:04:00", "PICKUP", "X", "IB59"),
    at("12:03:00", "FAIL", "X", "IB59", "[texted] 'X' : Font missing: Inter"), at("12:02:00", "PICKUP", "X", "IB59"),
    at("12:01:00", "FAIL", "X", "IB59", "[texted] 'X' : font missing: inter"), at("12:00:00", "PICKUP", "X", "IB59"),
  ];
  const [item] = collapseActivity(h);
  const r = item.repeat;
  assert.equal(r.fails, 3);
  assert.equal(splitReason(r.last.detail).plain, "AE crashed");
  assert.deepEqual(r.earlier.map((e) => [splitReason(e.detail).plain, e.count]), [["Font missing: Inter", 2]]);
  const same = collapseActivity([at("12:03:00", "FAIL", "Y", "IB59", "[texted] 'Y' : comp not found"), at("12:01:00", "FAIL", "Y", "IB59", "[texted] 'Y' : comp not found")]);
  assert.deepEqual(same[0].repeat.earlier, []);
});
ok("L1: a fold that starts with a newer 'started' row ends its range at the newest failure", () => {
  const h = [at("12:09:00", "PICKUP", "X", "IB59"), at("12:05:00", "FAIL", "X", "IB59", "a"), at("12:00:00", "FAIL", "X", "IB59", "a")];
  const r = collapseActivity(h)[0].repeat;
  assert.equal(r.to, "2026-11-27T12:05:00");
  assert.equal(fmtRange(parseFarmTime(r.from), parseFarmTime(r.to), utc("2026-11-27T12:00:00Z"), "Europe/Oslo"), "12:00-12:05");
});
ok("M2: next up is a waiting Premiere job, never the one rendering, checking or uploading", () => {
  const pj = [{ title: "R.prproj", state: "rendering", held: false }, { title: "U.prproj", state: "compared", held: false }, { title: "S.prproj", state: "syncing", held: false, working: true }, { title: "Q.prproj", state: "queued", held: false }];
  assert.equal(farmCounts({ queue: [], failed: [] }, pj).nextUp, "Q");
  assert.equal(farmCounts({ queue: [], failed: [] }, pj.slice(0, 2)).nextUp, null);
  assert.equal(premiereLine([{ title: "R", state: "rendering", held: false }, { title: "Q", state: "queued", held: false }]), "1 waiting");
  assert.equal(premiereLine([{ title: "R", state: "rendering", held: false }]), "nothing waiting");
  assert.equal(premiereLine(jobs), "5 need a decision · 45 on hold");
});
ok("L1: one bad end of a range shows the good end only; other years show the year", () => {
  const now = utc("2026-11-27T12:00:00Z");
  assert.equal(fmtRange(NaN, utc("2026-11-26T11:10:00Z"), now, "UTC"), "26 Nov, 11:10");
  assert.equal(fmtRange(utc("2026-11-27T11:10:00Z"), NaN, now, "UTC"), "11:10");
  assert.equal(fmtRange(NaN, NaN, now, "UTC"), "");
  assert.equal(fmtWhen(utc("2025-12-31T23:00:00Z"), now, "UTC"), "31 Dec 2025, 23:00");
});
ok("L1: Windows' Norwegian and US zone-less formats read as Oslo time too", () => {
  assert.equal(parseFarmTime("27.11.2026 12:42:11"), utc("2026-11-27T11:42:11Z"));
  assert.equal(parseFarmTime("11/27/2026 12:42:11"), utc("2026-11-27T11:42:11Z"));
  assert.equal(parseFarmTime("11/27/2026 12:42:11 PM"), utc("2026-11-27T11:42:11Z"));
  assert.equal(parseFarmTime("7/1/2026 12:00:00"), utc("2026-07-01T10:00:00Z"));
  assert.ok(Number.isNaN(parseFarmTime("13/40/2026 12:00:00")));
});
ok("L3: plain line never holds a UNC, drive, /Volumes, /var path or a link", () => {
  for (const t of ["could not open \\\\DESKTOP-8GE9O3G\\share\\x.aep", "missing D:/RF/work/x.aep", "missing /Volumes/Media/x.mov", "log at /var/log/x.txt",
    "upload failed http://100.98.10.32:8443/api/x", "upload failed https://dropbox.com/x"]) {
    const s = splitReason(t);
    assert.ok(!/[\\/]|https?:|\d+\.\d+\.\d+\.\d+/.test(s.plain), `${t} -> ${s.plain}`);
    assert.equal(s.details, t);
  }
  assert.equal(splitReason("missing D:/RF/work/x.aep").plain, "Missing");
  assert.deepEqual(splitReason("Font missing: Inter/Bold"), { plain: "Font missing: Inter/Bold", details: "" }, "a slash inside a word is not a path");
});
ok("L4: card links only to Notion over https", () => {
  for (const u of ["https://www.notion.so/abc", "https://notion.so/abc", "https://insanity.notion.site/abc"]) assert.equal(notionHref(u), u);
  for (const u of ["javascript:alert(1)", "http://www.notion.so/x", "https://evil.com/notion.so/", "https://notion.so.evil.com/x", "", null, undefined]) assert.equal(notionHref(u), undefined, String(u));
});
ok("M3: notices never show the PC's address, port, a link or a path", () => {
  assert.equal(noticeText("connect ECONNREFUSED 100.98.10.32:8443", 502), "connect ECONNREFUSED");
  assert.equal(noticeText("Render farm unreachable: connect ETIMEDOUT desktop-8ge9o3g.tail495db5.ts.net:8443", 502), "Render farm unreachable: connect ETIMEDOUT");
  assert.equal(noticeText("upstream http://127.0.0.1:8791/jobs failed", 502), "upstream");
  assert.equal(noticeText("Not re-queued: already queued", 409), "Not re-queued: already queued");
  assert.equal(noticeText(undefined, 500), "That did not work (HTTP 500). Try again in a minute.");
  assert.equal(noticeText({ x: 1 }, 400), "That did not work (HTTP 400). Try again in a minute.");
  assert.equal(noticeText("/opt/apps/x failed", 500), "That did not work (HTTP 500). Try again in a minute.");
});

// source checks: the fixed lines are where the error starts, and the page prints no raw error
const src = (f) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
const code = (f) => src(f).split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
ok("M3: API answers carry fixed lines; the real error is logged on the server only", () => {
  const farm = src("lib/renderfarm.ts"), pr = src("app/api/renderfarm/premiere/route.ts"), media = src("app/api/renderfarm/media/route.ts");
  assert.ok(!/error:\s*`[^`]*\$\{e\.message\}/.test(farm) && farm.includes('error: "The render PC is not answering"') && farm.includes("console.error("));
  assert.ok(!/error:\s*`[^`]*\$\{e instanceof Error/.test(pr) && pr.includes('error: "The Premiere list is not answering"') && pr.includes("console.error("));
  assert.ok(!/error:\s*String\(\(e as Error\)\.message/.test(media) && !/error: state\.error,/.test(media));
});
ok("M3 + L4: the page shows no raw server error, no em dash and no 'farm owner'", () => {
  for (const f of ["app/renderfarm/page.tsx", "app/renderfarm/PremiereQueue.tsx"]) {
    const c = code(f);
    assert.ok(!/console\.\w+\([^)]*body\.error/.test(c), `${f}: console prints body.error`);
    assert.ok(!/text:\s*body\.error\s*\|\|/.test(c) && !/\{media\.error\}|\? media\.error :/.test(c), `${f}: raw error on screen`);
    assert.ok(!c.includes("\u2014"), `${f}: em dash on screen`);
    assert.ok(!/farm owner/.test(c), f);
    assert.ok(!/href=\{c\.notionUrl\}|href=\{cardUrl\}/.test(c), `${f}: unchecked card link`);
  }
});
ok("L2: the top line does not wait forever on the Premiere list", () => {
  const c = code("app/renderfarm/page.tsx");
  assert.ok(/data && \(pjobs \|\| pDown\)/.test(c) && c.includes("Premiere list not answering"));
  assert.deepEqual(farmCounts({ queue: [{ name: "A" }], failed: [{}] }, []), { needDecision: 0, failed: 1, onHold: 0, nextUp: "A" });
});

if (process.argv[3]) {
  const live = JSON.parse(readFileSync(process.argv[2], "utf8"));
  const pj = JSON.parse(readFileSync(process.argv[3], "utf8"));
  console.log("real data:", topLine(farmCounts({ queue: live.queue.rows, failed: live.failed }, pj.jobs)));
  console.log("real data: header", fmtWhen(parseFarmTime(live.generatedAt)), "newest event", fmtWhen(parseFarmTime(live.history[0]?.timestamp)), `(viewer zone ${Intl.DateTimeFormat().resolvedOptions().timeZone})`);
  const items = collapseActivity(live.history);
  console.log(`real data: ${live.history.length} activity rows -> ${items.length} lines, ${items.filter((i) => "repeat" in i).length} folded`);
  const blank = live.failed.filter((c) => !splitReason(failedReason(c, live.history)).plain).length;
  console.log(`real data: ${live.failed.length} failed cards, ${blank} with no reason recorded`);
}
console.log(`all ${n} checks passed`);
