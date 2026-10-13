"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { allApps, appRequiresPortalAuth, getAppEnvironment, getAppHostname } from "@/lib/apps";

type AccessMap = Record<string, boolean>;

export default function StatusPage() {
  const { data: session } = useSession();
  const [access, setAccess] = useState<AccessMap>({});
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!session?.user) return;

    const run = async () => {
      try {
        const res = await fetch("/api/me");
        if (!res.ok) return;
        const data = await res.json();
        setAccess(data.access ?? {});
      } finally {
        setLoaded(true);
      }
    };

    void run();
  }, [session]);

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)" }}>
      <header
        style={{
          borderBottom: "1px solid var(--border)",
          padding: "14px 28px",
          display: "flex",
          alignItems: "center",
          gap: 12,
        }}
      >
        <a href="/" style={{ color: "var(--text-dim)", textDecoration: "none", fontSize: 18 }}>⌘</a>
        <span style={{ color: "var(--border)" }}>/</span>
        <h1
          style={{
            fontSize: 12,
            fontWeight: 700,
            letterSpacing: "0.15em",
            textTransform: "uppercase",
            margin: 0,
          }}
        >
          Portal Status
        </h1>
      </header>

      <main style={{ maxWidth: 1180, margin: "0 auto", padding: "32px 28px" }}>
        <div
          style={{
            marginBottom: 20,
            padding: 16,
            border: "1px solid var(--border)",
            background: "var(--bg-surface)",
            fontSize: 11,
            color: "var(--text-dim)",
          }}
        >
          Static registry audit for portal-managed apps. This shows the configured target URL, auth mode, handoff path, and your current access flag.
        </div>

        <div style={{ overflowX: "auto", border: "1px solid var(--border)", background: "var(--bg-surface)" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
            <thead>
              <tr>
                {['App', 'Environment', 'Auth', 'Access', 'Target Host', 'Handoff Path'].map((label) => (
                  <th
                    key={label}
                    style={{
                      textAlign: "left",
                      padding: "12px 14px",
                      color: "var(--text-muted)",
                      textTransform: "uppercase",
                      letterSpacing: "0.1em",
                      borderBottom: "1px solid var(--border)",
                    }}
                  >
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {allApps.map((app) => {
                const env = getAppEnvironment(app);
                const requiresAuth = appRequiresPortalAuth(app);
                const hasAccess = access[app.id] ?? false;
                return (
                  <tr key={app.id}>
                    <td style={{ padding: "12px 14px", borderBottom: "1px solid var(--border)" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span>{app.icon}</span>
                        <div>
                          <div style={{ fontWeight: 600, color: "var(--text)" }}>{app.name}</div>
                          <div style={{ color: "var(--text-muted)", marginTop: 2 }}>{app.id}</div>
                        </div>
                      </div>
                    </td>
                    <td style={{ padding: "12px 14px", borderBottom: "1px solid var(--border)", color: env === "production" ? "var(--green)" : "var(--amber)" }}>
                      {env}
                    </td>
                    <td style={{ padding: "12px 14px", borderBottom: "1px solid var(--border)", color: requiresAuth ? "var(--text)" : "var(--amber)" }}>
                      {requiresAuth ? "portal handoff" : "public"}
                    </td>
                    <td style={{ padding: "12px 14px", borderBottom: "1px solid var(--border)", color: loaded ? (hasAccess ? "var(--green)" : "var(--text-muted)") : "var(--text-muted)" }}>
                      {loaded ? (hasAccess ? "granted" : "locked") : "..."}
                    </td>
                    <td style={{ padding: "12px 14px", borderBottom: "1px solid var(--border)", color: "var(--text-dim)", fontFamily: "monospace" }}>
                      {getAppHostname(app)}
                    </td>
                    <td style={{ padding: "12px 14px", borderBottom: "1px solid var(--border)", color: "var(--text-dim)", fontFamily: "monospace" }}>
                      {app.handoffPath || "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  );
}
