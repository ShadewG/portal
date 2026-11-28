import { readFile } from "node:fs/promises";

/**
 * Real names for the /access page (B4, 28 Nov 2026). Read from Desk's team directory, the mirror of the Notion
 * Contractor Directory (/opt/apps/desk/data/directory.json, written by Desk), never copied into Portal's DB.
 * Matched by Discord id first, then by Discord username. Missing or unreadable file = no names (the page shows
 * Discord names only). Kept 60 s in memory.
 */
const FILE = process.env.DESK_PEOPLE_DIRECTORY ?? "/opt/apps/desk/data/directory.json";
const TTL_MS = 60_000;

interface Entry { name?: unknown; discord_id?: unknown; username?: unknown }
export interface NameBook { byDiscordId: Map<string, string>; byUsername: Map<string, string> }

let cached: { at: number; book: NameBook } | null = null;

const clean = (v: unknown) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, 80) : "");

export async function nameBook(now = Date.now()): Promise<NameBook> {
  if (cached && now - cached.at < TTL_MS) return cached.book;
  const book: NameBook = { byDiscordId: new Map(), byUsername: new Map() };
  try {
    const data = JSON.parse(await readFile(FILE, "utf8")) as { people?: Entry[] };
    for (const p of Array.isArray(data?.people) ? data.people : []) {
      const name = clean(p.name);
      if (!name) continue;
      const id = clean(p.discord_id);
      const user = clean(p.username).toLowerCase();
      if (/^\d{15,25}$/.test(id) && !book.byDiscordId.has(id)) book.byDiscordId.set(id, name);
      if (user && !book.byUsername.has(user)) book.byUsername.set(user, name);
    }
  } catch {
    // no directory on this machine, or it is being rewritten: Discord names only this minute
  }
  cached = { at: now, book };
  return book;
}

/** The person's real name, or null when the directory does not know them (or knows them only by the same handle). */
export function realName(book: NameBook, p: { discordId: string; username: string }): string | null {
  const name = book.byDiscordId.get(p.discordId) ?? book.byUsername.get(p.username.toLowerCase()) ?? null;
  return name && name.toLowerCase() !== p.username.toLowerCase() ? name : null;
}
