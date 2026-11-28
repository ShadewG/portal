"use client";

import { useSession, signOut } from "next-auth/react";
import { useCallback, useEffect, useState } from "react";
import { sections, type AppConfig } from "@/lib/apps";
import { plainOf } from "@/lib/plainNames";
import FeedbackButton from "./FeedbackButton";
import "./plain.css";

/**
 * Home (X6, R-3258 S4 + B8, 28 Nov 2026). The person's own apps first, as big tiles with a plain name and one line.
 * Everything locked is folded under "N more apps: Ask for access"; each row leads to the one no-access page.
 * A Hiring-only person (pulse.hiring without pulse) gets a "Hiring" tile that opens Pulse on that tab.
 * No tech tags, web addresses or status dots on tiles (UX-PRINCIPLES v2.2 rules 3, 5, 6, 11, 12).
 * An app whose Portal hand-off is off (signInOff, KPI until its gate is live) gets no tile at all (review N4).
 */

interface Me { access: Record<string, boolean>; isAdmin: boolean; discordId?: string }
interface Ask { grantId: string; name: string; state: string; at: string; answeredAt: string | null; by: string | null; note: string | null }
interface Who { can: "manage" | "read" | null; waiting: number; asks: Ask[]; tiles: string[]; offer: string[] }

const homeApps: AppConfig[] = sections.flatMap((s) => s.apps).filter((a) => !a.signInOff);
const open = (app: string, next?: string) => `/api/auth/redirect?${new URLSearchParams(next ? { app, next } : { app }).toString()}`;
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }) : "");
const RECENT_MS = 14 * 86_400_000;

/** Tiles for tabs a person opens without the app (lib/access.ts shellTabTiles). Today only Hiring in Pulse. */
const TAB_TILES: Record<string, { icon: string; href: string }> = {
  "pulse.hiring": { icon: "⌁", href: open("pulse", "/#hiring") },
};

function Tile({ icon, name, line, href }: { icon: string; name: string; line: string; href: string }) {
  return (
    <a className="pl-tile" href={href} data-tile={name}>
      <span className="pl-tile-icon" aria-hidden="true">{icon}</span>
      <span style={{ minWidth: 0 }}>
        <span className="pl-tile-name">{name}</span>
        {line && <span className="pl-tile-line">{line}</span>}
      </span>
    </a>
  );
}

function askWords(a: Ask): string {
  if (a.state === "approved") return `Given on ${day(a.answeredAt)}${a.by ? ` by ${a.by}` : ""}.`;
  if (a.state === "declined") return `Declined on ${day(a.answeredAt)}${a.by ? ` by ${a.by}` : ""}.${a.note ? ` "${a.note}"` : ""}`;
  return `Asked on ${day(a.at)}. Waiting for an answer.`;
}

export default function Home() {
  const { data: session } = useSession();
  const [me, setMe] = useState<Me | null>(null);
  const [who, setWho] = useState<Who | null>(null);
  const [status, setStatus] = useState<"loading" | "ok" | "error">("loading");

  const user = session?.user as { username?: string; globalName?: string; name?: string } | undefined;
  const displayName = user?.globalName || user?.username || user?.name || "";

  const load = useCallback(async () => {
    setStatus("loading");
    try {
      const res = await fetch("/api/me", { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      setMe(await res.json());
      const w = await fetch("/api/access/me", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
      setWho(w ? { can: w.can ?? null, waiting: Number(w.waiting) || 0, asks: Array.isArray(w.asks) ? w.asks : [], tiles: Array.isArray(w.tiles) ? w.tiles : [], offer: Array.isArray(w.offer) ? w.offer : [] } : null);
      setStatus("ok");
    } catch {
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    if (session?.user) load();
  }, [session, load]);

  const access = me?.access ?? {};
  const own = homeApps.filter((a) => access[a.id]);
  const tabTiles = (who?.tiles ?? []).filter((id) => TAB_TILES[id]);
  // Offered = what the server says this person may ask for (/api/access/me offer): never personal apps, old tools
  // (Archive, tile only, dead) or owner-decided ones for a plain member. No answer from the server: offer nothing.
  const offer = new Set(who?.offer ?? []);
  const locked = homeApps.filter((a) => !access[a.id] && !a.allowedDiscordId && offer.has(a.id));
  const asks = who?.asks ?? [];
  const askOf = new Map(asks.map((a) => [a.grantId, a]));
  const shownAsks = asks.filter((a) => a.state === "open" || Date.now() - Date.parse(a.answeredAt ?? a.at) < RECENT_MS);
  // Open asks for things not in the offered list (a Pulse tab like Servers, or an ask made before a tool was retired)
  // get a row too, so the "N asked" badge and "Your asks" always agree.
  const lockedIds = new Set(locked.map((a) => a.id));
  const askedElsewhere = asks.filter((a) => a.state === "open" && !lockedIds.has(a.grantId) && !access[a.grantId]);
  const rows = locked.length + askedElsewhere.length;
  const openAsks = asks.filter((a) => a.state === "open").length;

  return (
    <div className="pl pl-page">
      <header className="pl-top">
        <h1 style={{ margin: 0, fontSize: 20 }}>Home</h1>
        <nav aria-label="More">
          {who?.can && (
            <a className="pl-btn" href="/access" title={who.can === "manage" ? "Give and take access" : "See who has what (read only)"}>
              {who.waiting > 0 ? `Access: ${who.waiting} ${who.waiting === 1 ? "ask" : "asks"} waiting` : "Access"}
            </a>
          )}
          {me?.isAdmin && <a className="pl-link" href="/admin" style={{ padding: "0 8px" }}>Admin</a>}
          {me?.isAdmin && <a className="pl-link" href="/usage" style={{ padding: "0 8px" }}>Usage</a>}
          {me?.isAdmin && <a className="pl-link" href="/status" style={{ padding: "0 8px" }}>Status</a>}
          {displayName && <span className="pl-small" style={{ padding: "0 4px" }}>{displayName}</span>}
          <button className="pl-btn" onClick={() => signOut()}>Sign out</button>
        </nav>
      </header>

      <main className="pl-wide">
        <h2>Your apps</h2>
        {status === "loading" && <p className="pl-dim" role="status">Loading your apps...</p>}
        {status === "error" && (
          <div className="pl-note pl-err" role="alert">
            <p style={{ margin: "0 0 8px" }}>Your apps could not load.</p>
            <button className="pl-btn" onClick={load}>Try again</button>
          </div>
        )}
        {status === "ok" && (
          <>
            {own.length + tabTiles.length === 0 ? (
              <p className="pl-note">You have no apps yet. Open the list below and ask for the ones you need.</p>
            ) : (
              <div className="pl-tiles">
                {tabTiles.map((id) => (
                  <Tile key={id} icon={TAB_TILES[id].icon} name={plainOf(id).name} line={plainOf(id).line} href={TAB_TILES[id].href} />
                ))}
                {own.map((a) => <Tile key={a.id} icon={a.icon} name={plainOf(a.id, a.name).name} line={plainOf(a.id).line} href={open(a.id)} />)}
              </div>
            )}

            {shownAsks.length > 0 && (
              <section className="pl-card" style={{ marginBottom: 20 }} aria-label="Your asks">
                <h2 style={{ fontSize: 15 }}>Your asks</h2>
                {shownAsks.map((a) => (
                  <p key={a.grantId} style={{ margin: "0 0 8px" }}>
                    <b>{a.name}</b>: {askWords(a)}
                  </p>
                ))}
              </section>
            )}

            {rows > 0 && (
              <details className="pl-more">
                <summary className="pl-sum">
                  {rows} more {rows === 1 ? "app" : "apps"}: Ask for access
                  {openAsks > 0 && <span className="pl-badge" style={{ marginLeft: "auto" }} data-asked={openAsks}>{openAsks} asked</span>}
                </summary>
                {askedElsewhere.map((a) => (
                  <div className="pl-locked" key={a.grantId}>
                    <div>
                      <span className="pl-tile-name">{a.name}</span>
                      <span className="pl-tile-line">{plainOf(a.grantId).line}</span>
                    </div>
                    <span className="pl-badge">Asked {day(a.at)}</span>
                  </div>
                ))}
                {locked.map((a) => {
                  const asked = askOf.get(a.id);
                  return (
                    <div className="pl-locked" key={a.id}>
                      <div>
                        <span className="pl-tile-name">{plainOf(a.id, a.name).name}</span>
                        <span className="pl-tile-line">{plainOf(a.id).line}</span>
                      </div>
                      {asked?.state === "open"
                        ? <span className="pl-badge">Asked {day(asked.at)}</span>
                        : <a className="pl-btn" href={`/no-access?want=${encodeURIComponent(a.id)}`}>Ask for access</a>}
                    </div>
                  );
                })}
              </details>
            )}
          </>
        )}
      </main>
      {/* X6 S5: "This is confusing" note, signed-in people only */}
      {session?.user && <FeedbackButton page="/" />}
    </div>
  );
}
