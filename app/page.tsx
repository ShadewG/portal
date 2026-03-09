"use client";

import { useSession, signOut } from "next-auth/react";
import { apps, type AppConfig } from "@/lib/apps";
import { useState } from "react";

function StatusDot({ status }: { status: AppConfig["status"] }) {
  return <span className={`status-dot status-${status}`} title={status} />;
}

function AppCard({ app, index }: { app: AppConfig; index: number }) {
  return (
    <a
      href={app.url}
      target="_blank"
      rel="noopener noreferrer"
      className="card-hover animate-fade-in"
      style={{
        display: "block",
        border: "1px solid var(--border)",
        background: "var(--bg-surface)",
        padding: 24,
        textDecoration: "none",
        color: "inherit",
        animationDelay: `${index * 60}ms`,
        position: "relative",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: 2,
          background: app.color,
          opacity: 0.7,
        }}
      />
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 24 }}>{app.icon}</span>
          <div>
            <div
              style={{
                fontSize: 13,
                fontWeight: 700,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
              }}
            >
              {app.name}
            </div>
          </div>
        </div>
        <StatusDot status={app.status} />
      </div>
      <p
        style={{
          fontSize: 11,
          color: "var(--text-dim)",
          lineHeight: 1.6,
          margin: "0 0 16px",
        }}
      >
        {app.description}
      </p>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {app.tags.map((tag) => (
          <span
            key={tag}
            style={{
              fontSize: 9,
              fontWeight: 600,
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              padding: "3px 8px",
              background: "var(--bg-elevated)",
              border: "1px solid var(--border)",
              color: "var(--text-dim)",
            }}
          >
            {tag}
          </span>
        ))}
      </div>
    </a>
  );
}

export default function Dashboard() {
  const { data: session } = useSession();
  const [filter, setFilter] = useState("");

  const user = session?.user as
    | (typeof session & { user: { username?: string; globalName?: string; discordId?: string; avatar?: string } })["user"]
    | undefined;

  const displayName = user?.globalName || user?.username || user?.name || "Operator";

  const avatarUrl =
    user?.discordId && user?.avatar
      ? `https://cdn.discordapp.com/avatars/${user.discordId}/${user.avatar}.png?size=64`
      : undefined;

  const filtered = filter
    ? apps.filter(
        (a) =>
          a.name.toLowerCase().includes(filter.toLowerCase()) ||
          a.tags.some((t) => t.toLowerCase().includes(filter.toLowerCase()))
      )
    : apps;

  const liveCount = apps.filter((a) => a.status === "live").length;

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)" }}>
      {/* Header */}
      <header
        style={{
          borderBottom: "1px solid var(--border)",
          padding: "16px 32px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 20 }}>⌘</span>
          <h1
            style={{
              fontSize: 13,
              fontWeight: 700,
              letterSpacing: "0.15em",
              textTransform: "uppercase",
              margin: 0,
            }}
          >
            Command Center
          </h1>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {avatarUrl && (
              <img
                src={avatarUrl}
                alt=""
                width={24}
                height={24}
                style={{ borderRadius: "50%", border: "1px solid var(--border)" }}
              />
            )}
            <span style={{ fontSize: 11, color: "var(--text-dim)" }}>{displayName}</span>
          </div>
          <button
            onClick={() => signOut()}
            style={{
              fontSize: 10,
              fontWeight: 600,
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              padding: "6px 12px",
              background: "transparent",
              border: "1px solid var(--border)",
              color: "var(--text-dim)",
              fontFamily: "inherit",
              cursor: "pointer",
              transition: "all 0.15s",
            }}
            onMouseOver={(e) => {
              e.currentTarget.style.borderColor = "var(--red)";
              e.currentTarget.style.color = "var(--red)";
            }}
            onMouseOut={(e) => {
              e.currentTarget.style.borderColor = "var(--border)";
              e.currentTarget.style.color = "var(--text-dim)";
            }}
          >
            Sign Out
          </button>
        </div>
      </header>

      {/* Main */}
      <main style={{ maxWidth: 1100, margin: "0 auto", padding: "40px 32px" }}>
        {/* Stats bar */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 24,
            marginBottom: 32,
            padding: "16px 20px",
            border: "1px solid var(--border)",
            background: "var(--bg-surface)",
          }}
        >
          <div>
            <div style={{ fontSize: 9, fontWeight: 600, letterSpacing: "0.15em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 4 }}>
              Services
            </div>
            <div style={{ fontSize: 20, fontWeight: 700 }}>{apps.length}</div>
          </div>
          <div style={{ width: 1, height: 32, background: "var(--border)" }} />
          <div>
            <div style={{ fontSize: 9, fontWeight: 600, letterSpacing: "0.15em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 4 }}>
              Live
            </div>
            <div style={{ fontSize: 20, fontWeight: 700, color: "var(--green)" }}>{liveCount}</div>
          </div>
          <div style={{ width: 1, height: 32, background: "var(--border)" }} />
          <div>
            <div style={{ fontSize: 9, fontWeight: 600, letterSpacing: "0.15em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 4 }}>
              Platform
            </div>
            <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-dim)" }}>Railway</div>
          </div>
          <div style={{ flex: 1 }} />
          <input
            type="text"
            placeholder="Filter services..."
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            style={{
              fontSize: 11,
              fontFamily: "inherit",
              padding: "8px 14px",
              background: "var(--bg)",
              border: "1px solid var(--border)",
              color: "var(--text)",
              width: 200,
              outline: "none",
            }}
            onFocus={(e) => (e.currentTarget.style.borderColor = "var(--accent)")}
            onBlur={(e) => (e.currentTarget.style.borderColor = "var(--border)")}
          />
        </div>

        {/* App grid */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))",
            gap: 16,
          }}
        >
          {filtered.map((app, i) => (
            <AppCard key={app.id} app={app} index={i} />
          ))}
        </div>

        {filtered.length === 0 && (
          <div style={{ textAlign: "center", padding: 48, color: "var(--text-muted)", fontSize: 12 }}>
            No services match &quot;{filter}&quot;
          </div>
        )}
      </main>

      {/* Footer */}
      <footer
        style={{
          borderTop: "1px solid var(--border)",
          padding: "16px 32px",
          textAlign: "center",
          fontSize: 10,
          color: "var(--text-muted)",
          letterSpacing: "0.05em",
        }}
      >
        Deployed on Railway
      </footer>
    </div>
  );
}
