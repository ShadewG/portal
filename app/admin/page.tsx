"use client";

import { useSession } from "next-auth/react";
import { sections, allApps } from "@/lib/apps";
import { useState, useEffect, useCallback } from "react";

interface UserRow {
  id: string;
  discordId: string;
  username: string;
  avatar: string | null;
  email: string | null;
  isAdmin: boolean;
  createdAt: string;
  access: Record<string, boolean>;
}

interface PendingAccessRow {
  id: string;
  email: string;
  appId: string;
  granted: boolean;
  grantedBy: string | null;
  createdAt: string;
}

export default function AdminPage() {
  const { data: session } = useSession();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [pending, setPending] = useState<PendingAccessRow[]>([]);
  const [pendingEmail, setPendingEmail] = useState("");
  const [pendingAppId, setPendingAppId] = useState(allApps[0]?.id ?? "");
  const [pendingGranted, setPendingGranted] = useState(true);
  const [loading, setLoading] = useState(true);
  const [pendingLoading, setPendingLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingError, setPendingError] = useState<string | null>(null);
  const [toggling, setToggling] = useState<string | null>(null);
  const [pendingSubmitting, setPendingSubmitting] = useState(false);

  const isAdmin = (session?.user as Record<string, unknown> | undefined)?.isAdmin;

  const loadUsers = useCallback(async () => {
    try {
      const res = await fetch("/api/admin");
      if (res.status === 403) {
        setError("Access denied. Admin only.");
        return;
      }
      if (!res.ok) throw new Error("Failed to load users");
      setUsers(await res.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadPending = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/pending-access");
      if (res.status === 403) {
        setPendingError("Access denied. Admin only.");
        return;
      }
      if (!res.ok) throw new Error("Failed to load pending access");
      setPending(await res.json());
    } catch (err) {
      setPendingError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setPendingLoading(false);
    }
  }, []);

  useEffect(() => {
    if (session?.user) {
      loadUsers();
      loadPending();
    }
  }, [session, loadUsers, loadPending]);

  const toggleAccess = async (userId: string, appId: string, currentlyGranted: boolean) => {
    const key = `${userId}:${appId}`;
    setToggling(key);
    try {
      const res = await fetch("/api/admin", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, appId, granted: !currentlyGranted }),
      });
      if (res.ok) {
        setUsers((prev) =>
          prev.map((u) =>
            u.id === userId ? { ...u, access: { ...u.access, [appId]: !currentlyGranted } } : u
          )
        );
      }
    } finally {
      setToggling(null);
    }
  };

  const submitPending = async () => {
    if (!pendingEmail.trim() || !pendingAppId) return;
    setPendingSubmitting(true);
    try {
      const res = await fetch("/api/admin/pending-access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: pendingEmail.trim(),
          appId: pendingAppId,
          granted: pendingGranted,
        }),
      });
      if (!res.ok) throw new Error("Failed to save pending access");
      setPendingEmail("");
      await loadPending();
    } catch (err) {
      setPendingError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setPendingSubmitting(false);
    }
  };

  const removePending = async (email: string, appId: string) => {
    try {
      const res = await fetch("/api/admin/pending-access", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, appId }),
      });
      if (!res.ok) throw new Error("Failed to remove pending access");
      await loadPending();
    } catch (err) {
      setPendingError(err instanceof Error ? err.message : "Unknown error");
    }
  };

  if (!isAdmin) {
    return (
      <div style={{ minHeight: "100vh", background: "var(--bg)", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ color: "var(--red)", fontSize: 13 }}>Admin access required.</div>
      </div>
    );
  }

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
            color: "var(--amber)",
          }}
        >
          Access Control
        </h1>
      </header>

      <main style={{ maxWidth: 1200, margin: "0 auto", padding: "32px 28px" }}>
        {error && (
          <div style={{ padding: 16, border: "1px solid var(--red)", color: "var(--red)", marginBottom: 24, fontSize: 12 }}>
            {error}
          </div>
        )}

        <div style={{ marginBottom: 32, padding: 16, border: "1px solid var(--border)", background: "var(--bg-surface)" }}>
          <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 12 }}>
            Pre-Provisioned Access
          </div>
          {pendingError && (
            <div style={{ padding: 10, border: "1px solid var(--red)", color: "var(--red)", marginBottom: 12, fontSize: 11 }}>
              {pendingError}
            </div>
          )}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
            <input
              value={pendingEmail}
              onChange={(e) => setPendingEmail(e.target.value)}
              placeholder="email@example.com"
              style={{
                flex: "1 1 220px",
                padding: "8px 10px",
                border: "1px solid var(--border)",
                background: "transparent",
                color: "var(--text)",
                fontSize: 11,
                fontFamily: "inherit",
              }}
            />
            <select
              value={pendingAppId}
              onChange={(e) => setPendingAppId(e.target.value)}
              style={{
                flex: "0 0 200px",
                padding: "8px 10px",
                border: "1px solid var(--border)",
                background: "transparent",
                color: "var(--text)",
                fontSize: 11,
                fontFamily: "inherit",
              }}
            >
              {allApps.map((app) => (
                <option key={app.id} value={app.id}>
                  {app.name}
                </option>
              ))}
            </select>
            <select
              value={pendingGranted ? "grant" : "revoke"}
              onChange={(e) => setPendingGranted(e.target.value === "grant")}
              style={{
                flex: "0 0 140px",
                padding: "8px 10px",
                border: "1px solid var(--border)",
                background: "transparent",
                color: "var(--text)",
                fontSize: 11,
                fontFamily: "inherit",
              }}
            >
              <option value="grant">Grant</option>
              <option value="revoke">Revoke</option>
            </select>
            <button
              onClick={submitPending}
              disabled={pendingSubmitting || pendingLoading}
              style={{
                padding: "8px 14px",
                border: "1px solid var(--border)",
                background: "transparent",
                color: "var(--text)",
                fontSize: 11,
                fontFamily: "inherit",
                cursor: "pointer",
                opacity: pendingSubmitting || pendingLoading ? 0.6 : 1,
              }}
            >
              Save
            </button>
          </div>
          {pendingLoading ? (
            <div style={{ color: "var(--text-dim)", fontSize: 11 }}>Loading pending access...</div>
          ) : pending.length === 0 ? (
            <div style={{ color: "var(--text-dim)", fontSize: 11 }}>No pending access entries.</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {pending.map((row) => (
                <div
                  key={row.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 12,
                    padding: "6px 8px",
                    border: "1px solid var(--border)",
                    fontSize: 11,
                  }}
                >
                  <div style={{ color: "var(--text-dim)" }}>
                    {row.email} · {row.appId} · {row.granted ? "granted" : "revoked"}
                  </div>
                  <button
                    onClick={() => removePending(row.email, row.appId)}
                    style={{
                      border: "1px solid var(--border)",
                      background: "transparent",
                      color: "var(--text-dim)",
                      fontSize: 10,
                      padding: "4px 8px",
                      fontFamily: "inherit",
                      cursor: "pointer",
                    }}
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {loading ? (
          <div style={{ color: "var(--text-dim)", fontSize: 12 }}>Loading users...</div>
        ) : users.length === 0 ? (
          <div style={{ color: "var(--text-dim)", fontSize: 12 }}>
            No users have logged in yet. Users appear here after their first Discord sign-in.
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                fontSize: 11,
              }}
            >
              <thead>
                <tr style={{ borderBottom: "1px solid var(--border)" }}>
                  <th style={thStyle}>User</th>
                  {sections.map((section) => (
                    <th
                      key={section.id}
                      colSpan={section.apps.length}
                      style={{
                        ...thStyle,
                        borderLeft: "1px solid var(--border)",
                        color: section.color,
                      }}
                    >
                      {section.name}
                    </th>
                  ))}
                </tr>
                <tr style={{ borderBottom: "1px solid var(--border)" }}>
                  <th style={thStyle} />
                  {allApps.map((app) => (
                    <th
                      key={app.id}
                      style={{
                        ...thStyle,
                        fontSize: 9,
                        maxWidth: 80,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                      title={app.name}
                    >
                      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                        <span>
                          {app.icon} {app.name}
                        </span>
                        {app.requiresPortalAuth === false && (
                          <span
                            style={{
                              fontSize: 8,
                              color: "var(--text-muted)",
                              letterSpacing: "0.08em",
                              textTransform: "uppercase",
                            }}
                          >
                            Public
                          </span>
                        )}
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <tr key={user.id} style={{ borderBottom: "1px solid var(--border)" }}>
                    <td style={{ ...tdStyle, whiteSpace: "nowrap" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        {user.avatar && (
                          <img
                            src={`https://cdn.discordapp.com/avatars/${user.discordId}/${user.avatar}.png?size=32`}
                            alt=""
                            width={20}
                            height={20}
                            style={{ borderRadius: "50%" }}
                          />
                        )}
                        <div>
                          <div style={{ fontWeight: 600 }}>{user.username}</div>
                          {user.isAdmin && (
                            <span style={{ fontSize: 8, color: "var(--amber)", letterSpacing: "0.1em", textTransform: "uppercase" }}>
                              Admin
                            </span>
                          )}
                        </div>
                      </div>
                    </td>
                    {allApps.map((app) => {
                      const granted = user.isAdmin || user.access[app.id];
                      const key = `${user.id}:${app.id}`;
                      const isToggling = toggling === key;
                      return (
                        <td key={app.id} style={{ ...tdStyle, textAlign: "center" }}>
                          {user.isAdmin ? (
                            <span style={{ color: "var(--amber)", fontSize: 14 }} title="Admin (full access)">
                              ★
                            </span>
                          ) : (
                            <button
                              onClick={() => toggleAccess(user.id, app.id, user.access[app.id])}
                              disabled={isToggling}
                              style={{
                                width: 28,
                                height: 28,
                                border: `1px solid ${granted ? "var(--green)" : "var(--border)"}`,
                                background: granted ? "rgba(34, 197, 94, 0.15)" : "transparent",
                                color: granted ? "var(--green)" : "var(--text-muted)",
                                fontSize: 14,
                                cursor: "pointer",
                                fontFamily: "inherit",
                                opacity: isToggling ? 0.5 : 1,
                              }}
                            >
                              {granted ? "✓" : "×"}
                            </button>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div style={{ marginTop: 32, padding: 16, border: "1px solid var(--border)", background: "var(--bg-surface)" }}>
          <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 8 }}>
            How it works
          </div>
          <ul style={{ fontSize: 11, color: "var(--text-dim)", lineHeight: 1.8, margin: 0, paddingLeft: 16 }}>
            <li>New users appear after their first Discord sign-in. Default access: <strong style={{ color: "var(--red)" }}>none</strong>.</li>
            <li>Click a cell to grant/revoke access to a specific tool.</li>
            <li>Admins (★) have access to all tools automatically.</li>
            <li>Apps marked &quot;Public&quot; skip portal auth and access checks.</li>
            <li>Access is enforced on redirect — users without access see &quot;Locked&quot; cards.</li>
          </ul>
        </div>
      </main>
    </div>
  );
}

const thStyle: React.CSSProperties = {
  padding: "10px 8px",
  textAlign: "left",
  fontWeight: 600,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: "var(--text-dim)",
};

const tdStyle: React.CSSProperties = {
  padding: "10px 8px",
};
