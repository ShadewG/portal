"use client";

import { signIn } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";

// Signing in to Desk (2 Nov 2026): the callback is Portal's Desk handoff (/api/auth/redirect?app=desk…), so the card says
// what it is and who it is for — anyone on the Insanity team's Discord server gets in with their Discord account.
function forDesk(callbackUrl: string) {
  try {
    const u = new URL(callbackUrl, "https://portal.insanity.team");
    return u.pathname === "/api/auth/redirect" && u.searchParams.get("app") === "desk";
  } catch {
    return false;
  }
}

// The Desk app (0.24.4 and later sends /api/auth/desktop/approve to the default browser): sign in through the browser,
// where Discord is usually signed in already, instead of Discord's password, QR code and captcha in the app's window
// (10 Nov 2026, lib/desktopSignin.ts). Older apps would open that page inside themselves, so they keep the plain button.
function deskAppCanUseBrowser(): boolean {
  const m = navigator.userAgent.match(/InsanityDesk\/(\d+)\.(\d+)\.(\d+)/);
  if (!m) return false;
  const [a, b, c] = m.slice(1).map(Number);
  return a * 1e6 + b * 1e3 + c >= 24004;
}

// The browser's own sign-in step for the app (/api/auth/desktop/approve): the card says what it is for.
function forDesktopApprove(callbackUrl: string) {
  try {
    return new URL(callbackUrl, "https://portal.insanity.team").pathname === "/api/auth/desktop/approve";
  } catch {
    return false;
  }
}

// Sign-in text per app (X7, R-3258, 28 Nov 2026; Video Review text from plan-vr E7 S10, Training text from plan-training
// fix 17). The callback is Portal's hand-off /api/auth/redirect?app=<id>&next=<path>: only the app id (and, for the
// Sorter, whether next is a /review page) picks a fixed line from this table. Nothing from the address is shown.
// Any other callback keeps the default card.
type SignInText = { title: string; line: string };
const VIDEO_REVIEW: SignInText = { title: "Video Review", line: "Sign in with Discord to watch the video you were sent." };
const SIGNIN_TEXT: Record<string, SignInText> = {
  "video-review": VIDEO_REVIEW,
  "video-review-guest": VIDEO_REVIEW,
  "insanity-courses": { title: "Insanity Training", line: "Sign in with Discord to open your courses." }, // learn + /guides
};
function signInText(callbackUrl: string): SignInText | null {
  if (!callbackUrl.startsWith("/") || callbackUrl.startsWith("//")) return null; // Portal's own relative hand-off only
  try {
    const u = new URL(callbackUrl, "https://portal.insanity.team");
    if (u.pathname !== "/api/auth/redirect") return null;
    const app = u.searchParams.get("app") || "";
    if (app === "foia-sorter" && (u.searchParams.get("next") || "").startsWith("/review")) return VIDEO_REVIEW;
    return Object.prototype.hasOwnProperty.call(SIGNIN_TEXT, app) ? SIGNIN_TEXT[app] : null;
  } catch {
    return null;
  }
}

type Flow = { state: "idle" } | { state: "starting" } | { state: "waiting"; code: string; url: string } | { state: "done"; who: string | null };

function BrowserSignIn({ callbackUrl, onHere }: { callbackUrl: string; onHere: () => void }) {
  const [flow, setFlow] = useState<Flow>({ state: "idle" });
  const [note, setNote] = useState("");
  const timer = useRef<number | null>(null);
  const unhook = useRef<(() => void) | null>(null);
  const stop = () => { if (timer.current) window.clearInterval(timer.current); timer.current = null; if (unhook.current) unhook.current(); unhook.current = null; };
  useEffect(() => stop, []);
  async function begin() {
    stop();
    setNote("");
    setFlow({ state: "starting" });
    try {
      const r = await fetch("/api/auth/desktop/start", { method: "POST", credentials: "same-origin" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `Portal said ${r.status}`);
      setFlow({ state: "waiting", code: j.code, url: j.url });
      window.open(j.url, "_blank");
      // a hidden window's timers slow to about once a minute (the browser is in front while the person approves):
      // also check the moment the app comes back to the front (the browser's Done page brings it forward)
      const check = async () => {
        try {
          const p = await (await fetch("/api/auth/desktop/poll", { credentials: "same-origin", cache: "no-store" })).json();
          if (p.status === "done") { stop(); setFlow({ state: "done", who: p.who }); window.location.href = callbackUrl; }
          else if (p.status === "cancelled") { stop(); setFlow({ state: "idle" }); setNote("Cancelled in the browser. Nothing was signed in."); }
          else if (p.status === "expired") { stop(); setFlow({ state: "idle" }); setNote("That sign-in ran out. Press the button to start again."); }
        } catch { /* offline for a moment: the next check */ }
      };
      const onBack = () => { if (document.visibilityState === "visible") check(); };
      document.addEventListener("visibilitychange", onBack);
      window.addEventListener("focus", onBack);
      unhook.current = () => { document.removeEventListener("visibilitychange", onBack); window.removeEventListener("focus", onBack); };
      timer.current = window.setInterval(check, 1500);
    } catch (err) {
      setFlow({ state: "idle" });
      setNote(err instanceof Error ? err.message : "Could not start. Try again.");
    }
  }
  const btn = { display: "flex", alignItems: "center", justifyContent: "center", gap: 10, width: "100%", padding: "12px 24px", background: "#5865f2", color: "white", border: "none", fontSize: 13, fontWeight: 600, fontFamily: "inherit", letterSpacing: "0.05em", cursor: "pointer" } as const;
  const link = { background: "none", border: "none", color: "var(--text-dim)", fontSize: 11, fontFamily: "inherit", cursor: "pointer", textDecoration: "underline", marginTop: 16, letterSpacing: "0.03em" } as const;
  if (flow.state === "waiting" || flow.state === "done") {
    return (
      <div>
        <p style={{ fontSize: 12, color: "var(--text)", marginBottom: 12 }}>{flow.state === "done" ? `Signed in${flow.who ? ` as ${flow.who}` : ""}. Opening Desk…` : "Finish in your browser. It shows this code:"}</p>
        {flow.state === "waiting" ? (
          <>
            <div style={{ fontFamily: "ui-monospace, Consolas, monospace", fontSize: 26, fontWeight: 700, letterSpacing: "0.12em", color: "var(--text)", border: "1px solid var(--border)", padding: "14px 0", marginBottom: 18 }}>{flow.code}</div>
            <button style={btn} onClick={() => window.open(flow.url, "_blank")}>Open the browser again</button>
            <div style={{ display: "flex", justifyContent: "center", gap: 18 }}>
              <button style={link} onClick={() => { stop(); setFlow({ state: "idle" }); }}>Cancel</button>
              <button style={link} onClick={() => { stop(); onHere(); }}>Sign in here instead</button>
            </div>
          </>
        ) : null}
      </div>
    );
  }
  return (
    <div>
      <button style={btn} disabled={flow.state === "starting"} onClick={begin}>
        {flow.state === "starting" ? "Opening your browser…" : "Sign in with your browser"}
      </button>
      <p style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 12, letterSpacing: "0.03em" }}>Uses the Discord sign-in already in your browser.</p>
      {note ? <p style={{ fontSize: 11, color: "#e9cf8f", marginTop: 8 }}>{note}</p> : null}
      <button style={link} onClick={onHere}>Sign in here instead</button>
    </div>
  );
}

function LoginCard({ callbackUrl }: { callbackUrl: string }) {
  const approve = forDesktopApprove(callbackUrl);
  const desk = forDesk(callbackUrl) || approve;
  const text = desk ? null : signInText(callbackUrl);
  const [viaBrowser, setViaBrowser] = useState(false);
  useEffect(() => { if (!approve) setViaBrowser(deskAppCanUseBrowser()); }, [approve]);
  return (
    <div
      style={{
        border: "1px solid var(--border)",
        background: "var(--bg-surface)",
        padding: "48px",
        textAlign: "center",
        maxWidth: 420,
        width: "100%",
      }}
    >
      {desk ? null : <div style={{ fontSize: 32, marginBottom: 8 }}>⌘</div>}
      <h1
        style={{
          fontSize: 14,
          fontWeight: 700,
          letterSpacing: "0.15em",
          textTransform: "uppercase",
          color: "var(--text)",
          marginBottom: 8,
        }}
      >
        {desk ? "Insanity Desk" : text ? text.title : "Command Center"}
      </h1>
      <p
        style={{
          fontSize: 11,
          color: "var(--text-dim)",
          marginBottom: 32,
          letterSpacing: "0.05em",
        }}
      >
        {approve ? "Sign in with your Discord account to finish signing in the Insanity Desk app." : desk ? "For everyone on the Insanity team: sign in with the Discord account you use on the team's server." : text ? text.line : "Authenticate to continue"}
      </p>
      {viaBrowser ? <BrowserSignIn callbackUrl={callbackUrl} onHere={() => signIn("discord", { callbackUrl })} /> : (
      <button
        onClick={() => signIn("discord", { callbackUrl })}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 10,
          width: "100%",
          padding: "12px 24px",
          background: "#5865f2",
          color: "white",
          border: "none",
          fontSize: 13,
          fontWeight: 600,
          fontFamily: "inherit",
          letterSpacing: "0.05em",
          cursor: "pointer",
          transition: "background 0.15s",
        }}
        onMouseOver={(e) => (e.currentTarget.style.background = "#4752c4")}
        onMouseOut={(e) => (e.currentTarget.style.background = "#5865f2")}
      >
        <svg width="20" height="15" viewBox="0 0 71 55" fill="white">
          <path d="M60.1 4.9A58.5 58.5 0 0045.4.2a.2.2 0 00-.2.1 40.8 40.8 0 00-1.8 3.7c-5.5-.8-11-.8-16.3 0A37.4 37.4 0 0025.3.3a.2.2 0 00-.2-.1A58.4 58.4 0 0010.4 5a.2.2 0 00-.1.1C1.5 18.7-.9 32 .3 45.1a.3.3 0 00.1.2 58.7 58.7 0 0017.7 9 .2.2 0 00.3-.1 42 42 0 003.6-5.9.2.2 0 00-.1-.3 38.6 38.6 0 01-5.5-2.6.2.2 0 01.1-.4l1.1-.9a.2.2 0 01.2 0 41.8 41.8 0 0035.5 0 .2.2 0 01.2 0l1.1.9a.2.2 0 01.1.4 36.3 36.3 0 01-5.5 2.6.2.2 0 00-.1.3 47.2 47.2 0 003.6 5.9.2.2 0 00.3.1 58.5 58.5 0 0017.7-9 .3.3 0 00.1-.2c1.4-15-2.4-28-10-39.6a.2.2 0 00-.1-.1zM23.7 37c-3.4 0-6.3-3.1-6.3-7s2.8-7 6.3-7 6.4 3.2 6.3 7-2.8 7-6.3 7zm23.2 0c-3.4 0-6.3-3.1-6.3-7s2.8-7 6.3-7 6.4 3.2 6.3 7-2.8 7-6.3 7z" />
        </svg>
        Sign in with Discord
      </button>
      )}
    </div>
  );
}

function LoginContent() {
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callbackUrl") ?? "/";

  return <LoginCard callbackUrl={callbackUrl} />;
}

export default function LoginPage() {
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--bg)",
      }}
    >
      <Suspense fallback={<LoginCard callbackUrl="/" />}>
        <LoginContent />
      </Suspense>
    </div>
  );
}
