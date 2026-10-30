import { createHash, timingSafeEqual } from "node:crypto";

/** Map an editor-only bearer key to the server-owned identity; no Portal cookie or farm token. */
export function editorFor(header: string | null): string | null {
  const match = /^Bearer ([A-Za-z0-9_-]{32,256})$/.exec(header ?? "");
  if (!match) return null;
  const received = createHash("sha256").update(match[1]).digest();
  let editor: string | null = null;
  for (const entry of (process.env.RENDERFARM_QUEUE_KEYS || "").split(",")) {
    const index = entry.indexOf(":");
    if (index < 1) continue;
    const name = entry.slice(0, index).trim();
    const key = entry.slice(index + 1).trim();
    if (!/^[a-z][a-z0-9_-]{0,31}$/i.test(name) || key.length < 32) continue;
    const expected = createHash("sha256").update(key).digest();
    if (timingSafeEqual(received, expected)) editor = name;
  }
  return editor;
}
