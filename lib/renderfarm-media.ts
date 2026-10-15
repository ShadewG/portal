import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { farmRequest } from "@/lib/renderfarm";

/**
 * Previews of delivered renders for the Render Farm page (owner, 24 Sep 2026).
 *
 * The farm uploads each finished render to the team Dropbox and logs a DONE line whose detail
 * ends "-> /Insanity/.../<file>.mp4|.mov". Default renders are H.264 .mp4, which browsers play
 * straight from a Dropbox temporary link. Alpha renders are ProRes 4444 .mov, which Chrome cannot
 * play, so those get a one-off 720p H.264 copy (transparency flattened onto grey) cached on disk.
 *
 * Only paths the farm itself reports as delivered can be previewed: this must never become a way
 * to read arbitrary files from the team Dropbox.
 */

const CACHE = process.env.RENDER_FARM_MEDIA_CACHE || "/srv/london-data/apps/portal-renderfarm";
const CACHE_MAX_AGE_MS = 14 * 24 * 3600 * 1000;
const ALLOWED_TTL_MS = 10_000;
const LINK_TTL_MS = 3 * 3600 * 1000; // Dropbox temporary links live 4 h
const DONE_PATH = /-> (\/Insanity\/.+?\.(?:mp4|mov))(?=\s|$)/i;

export type Delivered = { path: string; name: string; episode: string; kind: string; timestamp: string };

/** The Dropbox path of a DONE history line, or null. */
export function deliveredPath(detail: string): string | null {
  const m = String(detail || "").match(DONE_PATH);
  return m ? m[1] : null;
}

export const isAlpha = (p: string) => /\.mov$/i.test(p);
const key = (p: string) => createHash("sha1").update(p).digest("hex");

// --- which paths may be previewed ---------------------------------------------------------------
// A path the farm has reported as delivered stays previewable for the life of the process; an
// unknown path triggers at most one fresh read of the farm's history every ALLOWED_TTL_MS.
const allowed = new Set<string>();
let checkedAt = 0;
/** Called with every live response the page receives, so its thumbnails need no extra farm call. */
export function rememberDelivered(history: { type: string; detail: string }[] | undefined) {
  for (const h of history || []) if (h.type === "DONE") { const d = deliveredPath(h.detail); if (d) allowed.add(d); }
}
export async function isDeliveredPath(p: string, actor: string): Promise<boolean> {
  if (!p.startsWith("/Insanity/") || p.includes("/../") || !/\.(mp4|mov)$/i.test(p)) return false;
  if (allowed.has(p)) return true;
  if (Date.now() - checkedAt < ALLOWED_TTL_MS) return false;
  checkedAt = Date.now();
  const r = await farmRequest("GET", "/api/portal/live", actor);
  const history = r.status === 200 ? (r.body as { history?: { type: string; detail: string }[] })?.history || [] : [];
  for (const h of history) if (h.type === "DONE") { const d = deliveredPath(h.detail); if (d) allowed.add(d); }
  return allowed.has(p);
}

// --- Dropbox --------------------------------------------------------------------------------------
let token: { value: string; until: number; headers: Record<string, string> } | null = null;
async function dropboxHeaders(): Promise<Record<string, string>> {
  if (token && Date.now() < token.until) return token.headers;
  const env = process.env;
  const res = await fetch("https://api.dropboxapi.com/oauth2/token", {
    method: "POST",
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: env.RENDER_FARM_DROPBOX_REFRESH_TOKEN || "",
      client_id: env.RENDER_FARM_DROPBOX_APP_KEY || "",
      client_secret: env.RENDER_FARM_DROPBOX_APP_SECRET || "",
    }),
  });
  if (!res.ok) throw new Error(`Dropbox sign-in failed (${res.status})`);
  const t = (await res.json()) as { access_token: string; expires_in: number };
  const headers: Record<string, string> = { Authorization: `Bearer ${t.access_token}`, "Dropbox-API-Select-User": env.RENDER_FARM_DROPBOX_SELECT_USER || "" };
  const acct = await fetch("https://api.dropboxapi.com/2/users/get_current_account", { method: "POST", headers });
  if (!acct.ok) throw new Error(`Dropbox account lookup failed (${acct.status})`);
  const root = ((await acct.json()) as { root_info: { root_namespace_id: string } }).root_info.root_namespace_id;
  headers["Dropbox-API-Path-Root"] = JSON.stringify({ ".tag": "root", root });
  token = { value: t.access_token, until: Date.now() + (t.expires_in - 120) * 1000, headers };
  return headers;
}

const links = new Map<string, { url: string; until: number }>();
export async function temporaryLink(p: string): Promise<string> {
  const hit = links.get(p);
  if (hit && Date.now() < hit.until) return hit.url;
  const res = await fetch("https://api.dropboxapi.com/2/files/get_temporary_link", {
    method: "POST",
    headers: { ...(await dropboxHeaders()), "Content-Type": "application/json" },
    body: JSON.stringify({ path: p }),
  });
  if (res.status === 409) throw Object.assign(new Error("This render is no longer at its Dropbox path"), { status: 404 });
  if (!res.ok) throw new Error(`Dropbox link failed (${res.status})`);
  const url = ((await res.json()) as { link: string }).link;
  links.set(p, { url, until: Date.now() + LINK_TTL_MS });
  return url;
}

// --- ffmpeg ---------------------------------------------------------------------------------------
function ffmpeg(args: string[], timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    // nice: this box serves every app; a preview must never compete with them.
    const p = spawn("nice", ["-n", "15", "ffmpeg", "-hide_banner", "-loglevel", "error", "-y", ...args], { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    p.stderr.on("data", (d) => { err = (err + d).slice(-600); });
    const timer = setTimeout(() => p.kill("SIGKILL"), timeoutMs);
    p.on("error", (e) => { clearTimeout(timer); reject(e); });
    p.on("close", (code) => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error(`ffmpeg failed: ${err.trim().split("\n").pop() || code}`)); });
  });
}

/** Transparent areas shown on dark grey, so an alpha render is readable in a normal player. */
const flatten = (w: number) => `[0:v]scale=${w}:-2,format=rgba,split[a][b];[a]drawbox=c=0x2a2a2a@1:t=fill[bg];[bg][b]overlay=format=auto,format=yuv420p[v]`;

const exists = async (f: string) => { try { return (await stat(f)).size > 0; } catch { return false; } };
const inflight = new Map<string, Promise<void>>();
function once(id: string, work: () => Promise<void>): Promise<void> {
  const running = inflight.get(id);
  if (running) return running;
  const p = work().finally(() => inflight.delete(id));
  inflight.set(id, p);
  return p;
}

async function prune(dir: string) {
  try {
    for (const f of await readdir(dir)) {
      const full = path.join(dir, f);
      const s = await stat(full).catch(() => null);
      if (s && Date.now() - s.mtimeMs > CACHE_MAX_AGE_MS) await rm(full, { force: true });
    }
  } catch { /* nothing cached yet */ }
}

/** A 480px JPEG of one frame (1 s in, or the first frame of a shorter clip). */
export async function posterFile(p: string): Promise<string> {
  const dir = path.join(CACHE, "posters"), out = path.join(dir, `${key(p)}.jpg`);
  if (await exists(out)) return out;
  await once(`poster:${p}`, async () => {
    await mkdir(dir, { recursive: true });
    const url = await temporaryLink(p), tmp = `${out}.part.jpg`;
    const grab = (at: string) => ffmpeg(["-ss", at, "-i", url, "-frames:v", "1", ...(isAlpha(p) ? ["-filter_complex", flatten(480), "-map", "[v]"] : ["-vf", "scale=480:-2"]), "-q:v", "4", tmp], 60_000);
    await grab("1").catch(() => grab("0"));
    await rename(tmp, out);
    void prune(dir);
  });
  return out;
}

/** State of the browser-playable copy of an alpha render; starts making it if missing. */
export async function alphaPreview(p: string): Promise<{ ready: boolean; file: string; error?: string }> {
  const dir = path.join(CACHE, "previews"), out = path.join(dir, `${key(p)}.mp4`);
  if (await exists(out)) return { ready: true, file: out };
  const failed = failures.get(p);
  if (failed && Date.now() - failed.at < 10 * 60_000) return { ready: false, file: out, error: failed.error };
  void once(`preview:${p}`, () => oneAtATime(async () => {
    await mkdir(dir, { recursive: true });
    const url = await temporaryLink(p), tmp = `${out}.part.mp4`;
    await ffmpeg(["-i", url, "-filter_complex", flatten(1280), "-map", "[v]", "-map", "0:a?", "-c:v", "libx264", "-preset", "veryfast", "-crf", "24",
      "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", tmp], 15 * 60_000);
    await rename(tmp, out);
    void prune(dir);
  })).catch((e) => { failures.set(p, { at: Date.now(), error: String(e?.message || e).slice(0, 200) }); });
  return { ready: false, file: out };
}
const failures = new Map<string, { at: number; error: string }>();

// Full alpha transcodes run one at a time (15 Oct 2026): the whole team can open previews now, and
// this 4-vCPU box serves every app. Posters (one frame each) are not queued.
let transcodeChain: Promise<unknown> = Promise.resolve();
function oneAtATime(work: () => Promise<void>): Promise<void> {
  const run = transcodeChain.then(work, work);
  transcodeChain = run.catch(() => undefined);
  return run;
}
