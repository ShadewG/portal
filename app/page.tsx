"use client";

import { useSession, signOut } from "next-auth/react";
import {
  sections,
  appRequiresPortalAuth,
  getAppEnvironment,
  getAppHostname,
  type AppConfig,
  type AppSection,
} from "@/lib/apps";
import { useState, useEffect, useCallback } from "react";

type AccessMap = Record<string, boolean>;

function StatusDot({ status }: { status: AppConfig["status"] }) {
  return <span className={`status-dot status-${status}`} title={status} />;
}

function buildAppRedirectHref(app: AppConfig, returnTo?: string) {
  const params = new URLSearchParams({ app: app.id });
  if (returnTo) {
    params.set("returnTo", returnTo);
  }
  return `/api/auth/redirect?${params.toString()}`;
}

function AppCard({
  app,
  hasAccess,
  index,
}: {
  app: AppConfig;
  hasAccess: boolean;
  index: number;
}) {
  const openHref = hasAccess ? buildAppRedirectHref(app) : undefined;
  const environment = getAppEnvironment(app);
  const authMode = appRequiresPortalAuth(app) ? "portal handoff" : "public";
  const hostname = getAppHostname(app);

  return (
    <div
      className={`card-hover animate-fade-in ${!hasAccess ? "locked" : ""}`}
      style={{
        border: "1px solid var(--border)",
        background: hasAccess ? "var(--bg-surface)" : "var(--bg)",
        padding: 20,
        color: "inherit",
        animationDelay: `${index * 50}ms`,
        position: "relative",
        overflow: "hidden",
        opacity: hasAccess ? 1 : 0.4,
        cursor: hasAccess ? "default" : "not-allowed",
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
          opacity: hasAccess ? 0.7 : 0.2,
        }}
      />
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 20 }}>{app.icon}</span>
          <span
            style={{
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
            }}
          >
            {app.name}
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {!hasAccess && (
            <span style={{ fontSize: 9, color: "var(--text-muted)", letterSpacing: "0.1em", textTransform: "uppercase" }}>
              Locked
            </span>
          )}
          <StatusDot status={app.status} />
        </div>
      </div>
      <p style={{ fontSize: 11, color: "var(--text-dim)", lineHeight: 1.5, margin: 0 }}>
        {app.description}
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 12 }}>
        <span style={{ fontSize: 9, color: environment === "production" ? "var(--green)" : "var(--amber)", letterSpacing: "0.08em", textTransform: "uppercase" }}>
          {environment}
        </span>
        <span style={{ fontSize: 9, color: "var(--text-muted)", letterSpacing: "0.08em", textTransform: "uppercase" }}>
          {authMode}
        </span>
      </div>
      <div style={{ marginTop: 8, fontSize: 10, color: "var(--text-muted)", fontFamily: "monospace", wordBreak: "break-all" }}>
        {hostname}
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
        {openHref ? (
          <a
            href={openHref}
            style={{
              flex: 1,
              textAlign: "center",
              padding: "8px 10px",
              border: "1px solid var(--border)",
              textDecoration: "none",
              color: "var(--text)",
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              background: "transparent",
            }}
          >
            Open
          </a>
        ) : (
          <div
            style={{
              flex: 1,
              textAlign: "center",
              padding: "8px 10px",
              border: "1px solid var(--border)",
              color: "var(--text-muted)",
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
            }}
          >
            Locked
          </div>
        )}
      </div>
    </div>
  );
}

function SectionBlock({
  section,
  access,
  startIndex,
}: {
  section: AppSection;
  access: AccessMap;
  startIndex: number;
}) {
  return (
    <div style={{ marginBottom: 40 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
        <div style={{ width: 3, height: 20, background: section.color }} />
        <h2
          style={{
            fontSize: 12,
            fontWeight: 700,
            letterSpacing: "0.15em",
            textTransform: "uppercase",
            margin: 0,
            color: "var(--text)",
          }}
        >
          {section.name}
        </h2>
        <span style={{ fontSize: 10, color: "var(--text-muted)" }}>{section.description}</span>
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
          gap: 12,
        }}
      >
        {section.apps.map((app, i) => (
          <AppCard key={app.id} app={app} hasAccess={access[app.id] ?? false} index={startIndex + i} />
        ))}
      </div>
    </div>
  );
}

export default function Dashboard() {
  const { data: session } = useSession();
  const [access, setAccess] = useState<AccessMap>({});
  const [isAdmin, setIsAdmin] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const user = session?.user as
    | { username?: string; globalName?: string; discordId?: string; avatar?: string; name?: string; isAdmin?: boolean }
    | undefined;

  const displayName = user?.globalName || user?.username || user?.name || "Operator";
  const avatarUrl =
    user?.discordId && user?.avatar
      ? `https://cdn.discordapp.com/avatars/${user.discordId}/${user.avatar}.png?size=64`
      : undefined;

  const loadAccess = useCallback(async () => {
    try {
      const res = await fetch("/api/me");
      if (res.ok) {
        const data = await res.json();
        setAccess(data.access ?? {});
        setIsAdmin(data.isAdmin ?? false);
      }
    } catch {
      // Silently handle — will show all locked
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (session?.user) loadAccess();
  }, [session, loadAccess]);

  const accessibleCount = Object.values(access).filter(Boolean).length;
  let idx = 0;

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)" }}>
      <header
        style={{
          borderBottom: "1px solid var(--border)",
          padding: "14px 28px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 18 }}>⌘</span>
          <h1
            style={{
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: "0.15em",
              textTransform: "uppercase",
              margin: 0,
            }}
          >
            Command Center
          </h1>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          {isAdmin && (
            <a
              href="/status"
              style={{
                fontSize: 10,
                fontWeight: 600,
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                padding: "5px 10px",
                background: "transparent",
                border: "1px solid var(--border)",
                color: "var(--text-dim)",
                textDecoration: "none",
                fontFamily: "inherit",
              }}
            >
              Status
            </a>
          )}
          {isAdmin && (
            <a
              href="/admin"
              style={{
                fontSize: 10,
                fontWeight: 600,
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                padding: "5px 10px",
                background: "transparent",
                border: "1px solid var(--amber)",
                color: "var(--amber)",
                textDecoration: "none",
                fontFamily: "inherit",
              }}
            >
              Admin
            </a>
          )}
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {avatarUrl && (
              <img
                src={avatarUrl}
                alt=""
                width={22}
                height={22}
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
              padding: "5px 10px",
              background: "transparent",
              border: "1px solid var(--border)",
              color: "var(--text-dim)",
              fontFamily: "inherit",
              cursor: "pointer",
            }}
          >
            Sign Out
          </button>
        </div>
      </header>

      <main style={{ maxWidth: 1000, margin: "0 auto", padding: "32px 28px" }}>
        {/* Stats */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 20,
            marginBottom: 32,
            padding: "14px 18px",
            border: "1px solid var(--border)",
            background: "var(--bg-surface)",
          }}
        >
          <div>
            <div style={{ fontSize: 9, fontWeight: 600, letterSpacing: "0.15em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 3 }}>
              Sections
            </div>
            <div style={{ fontSize: 18, fontWeight: 700 }}>{sections.length}</div>
          </div>
          <div style={{ width: 1, height: 28, background: "var(--border)" }} />
          <div>
            <div style={{ fontSize: 9, fontWeight: 600, letterSpacing: "0.15em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 3 }}>
              Your Access
            </div>
            <div style={{ fontSize: 18, fontWeight: 700, color: loaded ? "var(--green)" : "var(--text-dim)" }}>
              {loaded ? accessibleCount : "..."}
            </div>
          </div>
          <div style={{ width: 1, height: 28, background: "var(--border)" }} />
          <div>
            <div style={{ fontSize: 9, fontWeight: 600, letterSpacing: "0.15em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 3 }}>
              Role
            </div>
            <div
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: isAdmin ? "var(--amber)" : "var(--text-dim)",
              }}
            >
              {loaded ? (isAdmin ? "Admin" : "Member") : "..."}
            </div>
          </div>
        </div>

        {/* Sections */}
        {sections.map((section) => {
          const start = idx;
          idx += section.apps.length;
          return (
            <SectionBlock key={section.id} section={section} access={access} startIndex={start} />
          );
        })}
      </main>
    </div>
  );
}
