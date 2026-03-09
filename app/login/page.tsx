"use client";

import { signIn } from "next-auth/react";
import { useSearchParams } from "next/navigation";

export default function LoginPage() {
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callbackUrl") ?? "/";

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
        <div style={{ fontSize: 32, marginBottom: 8 }}>⌘</div>
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
          Command Center
        </h1>
        <p
          style={{
            fontSize: 11,
            color: "var(--text-dim)",
            marginBottom: 32,
            letterSpacing: "0.05em",
          }}
        >
          Authenticate to continue
        </p>
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
      </div>
    </div>
  );
}
