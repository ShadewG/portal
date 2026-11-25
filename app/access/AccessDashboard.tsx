"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { sections } from "@/lib/apps";

/**
 * /access dashboard (R-2159 M3). Client only renders and stages; every rule and every write is on the server
 * (/api/access/admin/*): who may change what, what a person can see (lib/access.ts), batch saves, undo.
 */

type Can = "manage" | "read";
interface Grant { id: string; label: string; app: string; kind: "app" | "tab"; enforced: boolean; note: string | null }
interface Person {
  id: string; username: string; avatarUrl: string | null; isOwner: boolean; isAdmin: boolean; isAccessAdmin: boolean;
  isYou: boolean; rows: Record<string, { on: boolean; auto: boolean }>; sees: string[]; lockedReason: string | null;
}
interface Preset { id: string; name: string; description: string | null; grantIds: string[]; by: string | null; updatedAt: string }
interface State { viewer: { can: Can; isOwner: boolean; name: string | null }; catalog: Grant[]; baseline: string[]; people: Person[]; presets: Preset[] }
interface AuditRow { person: string; personId: string | null; grantId: string; grant: string; from: string; to: string }
interface Change {
  changeId: string; at: string; by: string; note: string | null; isUndo: boolean; undoOfAt: string | null;
  undoneAt: string | null; undoneBy: string | null; pending: boolean; rows: AuditRow[];
}
interface PendingRow {
  id: string; email: string; grantId: string; grantLabel: string; granted: boolean; status: string;
  createdAt: string; resolvedAt: string | null; person: string | null; by: string | null;
}
interface DryPerson {
  userId: string; username: string; gains: string[]; loses: string[];
  changes: { grantId: string; from: boolean; to: boolean; stale: boolean }[];
}
type Staged = Record<string, boolean>;
type Tab = "people" | "matrix" | "audit" | "pending" | "presets" | "admins";
const TABS: { id: Tab; label: string }[] = [
  { id: "people", label: "People" }, { id: "matrix", label: "Matrix" }, { id: "audit", label: "Audit log" },
  { id: "pending", label: "Pre-grants" }, { id: "presets", label: "Presets" }, { id: "admins", label: "Access admins" },
];

async function api<T>(url: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const res = await fetch(url, {
    method: init?.method ?? "GET",
    headers: init?.body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error || `Request failed (${res.status})`);
  return data as T;
}

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "");
const stateWord = (s: string) => (s === "on" ? "on" : s === "off" ? "off" : "not set");
const onOff = (b: boolean) => (b ? "on" : "off");

function Avatar({ url, size = 24 }: { url: string | null; size?: number }) {
  if (!url) return <span style={{ width: size, height: size, borderRadius: "50%", background: "var(--bg-elevated)", border: "1px solid var(--border)", flex: "0 0 auto" }} />;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={url} alt="" width={size} height={size} style={{ borderRadius: "50%", border: "1px solid var(--border)", flex: "0 0 auto" }} />;
}

function Badges({ p }: { p: Person }) {
  return (
    <span style={{ display: "inline-flex", flexWrap: "wrap", gap: 4 }}>
      {p.isOwner && <span className="ax-badge" style={{ color: "var(--amber)" }}>Owner</span>}
      {!p.isOwner && p.isAdmin && <span className="ax-badge" style={{ color: "var(--amber)" }}>Portal admin</span>}
      {p.isAccessAdmin && <span className="ax-badge" style={{ color: "var(--accent)" }}>Access admin</span>}
      {p.isYou && <span className="ax-badge" style={{ color: "var(--text-dim)" }}>You</span>}
    </span>
  );
}

function Box({ kind, children }: { kind: "error" | "info" | "warn"; children: React.ReactNode }) {
  const color = kind === "error" ? "var(--red)" : kind === "warn" ? "var(--amber)" : "var(--text-dim)";
  return <div role={kind === "error" ? "alert" : undefined} style={{ padding: "10px 12px", border: `1px solid ${color}`, color, fontSize: 11, lineHeight: 1.5, marginBottom: 12 }}>{children}</div>;
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div style={{ padding: "28px 16px", textAlign: "center", color: "var(--text-dim)", fontSize: 11 }}>{children}</div>;
}

export default function AccessDashboard({ can, isOwner }: { can: Can; isOwner: boolean }) {
  const [state, setState] = useState<State | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("people");
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ text: string; undo?: string; error?: boolean } | null>(null);
  const [auditPerson, setAuditPerson] = useState("");
  const manage = can === "manage";

  const load = useCallback(async () => {
    try {
      setLoadError(null);
      setState(await api<State>("/api/access/admin"));
    } catch (e) {
      setLoadError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    const t = sp.get("tab") as Tab | null;
    if (t && TABS.some((x) => x.id === t)) setTab(t);
    if (sp.get("person")) setSelectedId(sp.get("person"));
    load();
  }, [load]);

  useEffect(() => {
    const sp = new URLSearchParams();
    if (tab !== "people") sp.set("tab", tab);
    if (tab === "people" && selectedId) sp.set("person", selectedId);
    const qs = sp.toString();
    window.history.replaceState(null, "", qs ? `/access?${qs}` : "/access");
  }, [tab, selectedId]);

  useEffect(() => {
    if (!toast || toast.undo) return;
    const t = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(t);
  }, [toast]);

  const undoFromToast = async (changeId: string) => {
    try {
      await api("/api/access/admin/revert", { method: "POST", body: { changeId } });
      setToast({ text: "Undone." });
      await load();
    } catch (e) {
      setToast({ text: `Undo refused: ${(e as Error).message}`, error: true });
    }
  };

  const people = state?.people ?? [];
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const base = new Set(state?.baseline ?? []);
    return people.filter((p) => {
      if (needle && !p.username.toLowerCase().includes(needle)) return false;
      if (filter === "admins") return p.isAdmin || p.isAccessAdmin;
      if (filter === "none") return p.sees.every((g) => base.has(g));
      if (filter.startsWith("can:")) return p.sees.includes(filter.slice(4));
      return true;
    });
  }, [people, q, filter, state?.baseline]);

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)" }}>
      <header className="ax-header">
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <a href="/" style={{ color: "var(--text-dim)", textDecoration: "none", fontSize: 18 }} aria-label="Home">⌘</a>
          <span style={{ color: "var(--border)" }}>/</span>
          <h1 style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.15em", textTransform: "uppercase", margin: 0, color: "var(--amber)" }}>Access</h1>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          {!manage && <span className="ax-badge" style={{ color: "var(--text-dim)" }}>Read only</span>}
          {isOwner && <span className="ax-badge" style={{ color: "var(--amber)" }}>Owner</span>}
          <a href="/admin" style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", padding: "5px 10px", border: "1px solid var(--border)", color: "var(--text-dim)", textDecoration: "none" }}>Old admin page</a>
        </div>
      </header>
      <nav className="ax-tabs" role="tablist" aria-label="Access sections">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} className="ax-tab" onClick={() => setTab(t.id)}>{t.label}</button>
        ))}
      </nav>
      <main className="ax-main">
        {!manage && (
          <Box kind="info">Read only. You can see who has what, but only the owner and access admins can change it. The old admin page still works for you.</Box>
        )}
        {loadError ? (
          <div className="ax-card" style={{ padding: 20 }}>
            <Box kind="error">Could not load access: {loadError}</Box>
            <button className="ax-btn" onClick={load}>Try again</button>
          </div>
        ) : !state ? (
          <div className="ax-card"><Empty>Loading access...</Empty></div>
        ) : (
          <>
            {(tab === "people" || tab === "matrix") && (
              <Filters q={q} setQ={setQ} filter={filter} setFilter={setFilter} catalog={state.catalog} count={filtered.length} total={people.length} />
            )}
            {tab === "people" && (
              <PeopleView state={state} list={filtered} selectedId={selectedId} setSelectedId={setSelectedId} manage={manage}
                onSaved={async (changeId) => { await load(); setToast({ text: "Saved.", undo: changeId ?? undefined }); }}
                showHistory={(id) => { setTab("audit"); setAuditPerson(id); }} />
            )}
            {tab === "matrix" && (
              <MatrixView state={state} list={filtered} manage={manage}
                onSaved={async (changeId, n) => { await load(); setToast({ text: `Saved ${n} changes.`, undo: changeId ?? undefined }); }} />
            )}
            {tab === "audit" && <AuditView people={people} catalog={state.catalog} manage={manage} personFilter={auditPerson} setPersonFilter={setAuditPerson} onUndone={load} />}
            {tab === "pending" && <PendingView />}
            {tab === "presets" && <PresetsView state={state} manage={manage} reload={load} notify={(text) => setToast({ text })} />}
            {tab === "admins" && <AdminsView people={people} isOwner={isOwner} reload={load} notify={(text, error) => setToast({ text, error })} />}
          </>
        )}
      </main>
      {toast && (
        <div className="ax-toast ax-card" role="status" style={{ padding: "10px 12px", display: "flex", alignItems: "center", gap: 10, borderColor: toast.error ? "var(--red)" : "var(--green)" }}>
          <span style={{ fontSize: 11, color: toast.error ? "var(--red)" : "var(--text)", flex: 1 }}>{toast.text}</span>
          {toast.undo && manage && <button className="ax-btn" onClick={() => undoFromToast(toast.undo!)}>Undo</button>}
          <button className="ax-btn" aria-label="Close" onClick={() => setToast(null)}>×</button>
        </div>
      )}
    </div>
  );
}

// ---------- shared bits ----------

interface AppGroup { section: { id: string; name: string; color: string }; apps: { grant: Grant; icon: string; tabs: Grant[] }[] }

function groupsOf(catalog: Grant[]): AppGroup[] {
  const byId = new Map(catalog.map((g) => [g.id, g]));
  return sections.map((s) => ({
    section: { id: s.id, name: s.name, color: s.color },
    apps: s.apps.filter((a) => byId.has(a.id)).map((a) => ({
      grant: byId.get(a.id)!, icon: a.icon, tabs: catalog.filter((g) => g.kind === "tab" && g.app === a.id),
    })),
  }));
}

const storedOf = (p: Person, id: string) => p.rows[id]?.on === true;
const valueOf = (p: Person, staged: Staged | undefined, id: string) => (staged && id in staged ? staged[id] : storedOf(p, id));
function toggled(p: Person, staged: Staged, id: string): Staged {
  const next = { ...staged };
  const v = !valueOf(p, staged, id);
  if (v === storedOf(p, id)) delete next[id];
  else next[id] = v;
  return next;
}
const itemOf = (p: Person, staged: Staged) => ({
  userId: p.id,
  changes: Object.entries(staged).map(([grantId, granted]) => ({ grantId, granted, expect: storedOf(p, grantId) })),
});

function Filters({ q, setQ, filter, setFilter, catalog, count, total }: {
  q: string; setQ: (v: string) => void; filter: string; setFilter: (v: string) => void; catalog: Grant[]; count: number; total: number;
}) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 14, alignItems: "center" }}>
      <input className="ax-input" type="search" placeholder="Search name or Discord username" value={q} onChange={(e) => setQ(e.target.value)}
        aria-label="Search people" style={{ flex: "1 1 240px" }} />
      <select className="ax-input" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter people" style={{ flex: "0 1 240px" }}>
        <option value="all">Everyone</option>
        <option value="admins">Admins (Portal or access)</option>
        <option value="none">No access</option>
        <optgroup label="Can open">
          {catalog.map((g) => <option key={g.id} value={`can:${g.id}`}>{g.kind === "tab" ? `  ${g.label}` : g.label}</option>)}
        </optgroup>
      </select>
      <span className="ax-label">{count} of {total} people</span>
    </div>
  );
}

// ---------- people ----------

function PeopleView({ state, list, selectedId, setSelectedId, manage, onSaved, showHistory }: {
  state: State; list: Person[]; selectedId: string | null; setSelectedId: (id: string | null) => void; manage: boolean;
  onSaved: (changeId: string | null) => Promise<void>; showHistory: (id: string) => void;
}) {
  const selected = state.people.find((p) => p.id === selectedId) ?? null;
  const appCount = (p: Person) => state.catalog.filter((g) => g.kind === "app" && p.sees.includes(g.id)).length;
  const tabCount = (p: Person) => state.catalog.filter((g) => g.kind === "tab" && p.sees.includes(g.id)).length;
  return (
    <div className="ax-people" data-selected={selected ? "true" : "false"}>
      <div className="ax-list ax-card" style={{ maxHeight: "calc(100vh - 220px)", overflowY: "auto" }}>
        {list.length === 0 ? <Empty>Nobody matches. Clear the search or pick another filter.</Empty> : list.map((p) => (
          <button key={p.id} className="ax-person-item" aria-current={p.id === selectedId} onClick={() => setSelectedId(p.id)}>
            <Avatar url={p.avatarUrl} size={28} />
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: "block", fontSize: 12, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.username}</span>
              <span style={{ display: "block", fontSize: 10, color: "var(--text-muted)", marginTop: 2 }}>
                {appCount(p)} apps{tabCount(p) ? `, ${tabCount(p)} tabs` : ""}
              </span>
            </span>
            <Badges p={p} />
          </button>
        ))}
      </div>
      <div className="ax-detail-col">
        {selected ? (
          <PersonDetail key={selected.id} state={state} person={selected} manage={manage} onSaved={onSaved}
            onBack={() => setSelectedId(null)} showHistory={() => showHistory(selected.id)} />
        ) : (
          <div className="ax-card"><Empty>Pick a person to see and change what they can open.</Empty></div>
        )}
      </div>
    </div>
  );
}

function PersonDetail({ state, person, manage, onSaved, onBack, showHistory }: {
  state: State; person: Person; manage: boolean; onSaved: (changeId: string | null) => Promise<void>; onBack: () => void; showHistory: () => void;
}) {
  const [staged, setStaged] = useState<Staged>({});
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ now: string[]; after: string[] } | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [presetMsg, setPresetMsg] = useState<string | null>(null);
  const locked = !manage ? "Read only." : person.lockedReason ? `Locked: ${person.lockedReason}.` : null;
  const groups = useMemo(() => groupsOf(state.catalog), [state.catalog]);
  const n = Object.keys(staged).length;
  const seq = useRef(0);

  useEffect(() => {
    const my = ++seq.current;
    const t = setTimeout(async () => {
      try {
        const r = await api<{ now: string[]; after: string[] }>("/api/access/admin/preview", { method: "POST", body: { userId: person.id, staged } });
        if (my === seq.current) { setPreview(r); setPreviewError(null); }
      } catch (e) {
        if (my === seq.current) setPreviewError((e as Error).message);
      }
    }, 200);
    return () => clearTimeout(t);
  }, [person.id, staged]);

  const sees = new Set(preview?.after ?? person.sees);
  const fillPreset = (id: string) => {
    const preset = state.presets.find((p) => p.id === id);
    if (!preset) return;
    const next: Staged = {};
    for (const g of state.catalog) {
      const want = preset.grantIds.includes(g.id);
      if (want !== storedOf(person, g.id)) next[g.id] = want;
    }
    setStaged(next);
    setPresetMsg(`Filled from "${preset.name}". Nothing is saved until you press Save.`);
  };
  const save = async () => {
    setSaving(true); setError(null);
    try {
      const r = await api<{ changeId: string | null }>("/api/access/admin/changes", { method: "POST", body: { items: [itemOf(person, staged)], note } });
      setStaged({}); setNote(""); setPresetMsg(null);
      await onSaved(r.changeId);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const row = (g: Grant, icon?: string) => {
    const v = valueOf(person, staged, g.id);
    const isStaged = g.id in staged;
    const tags: { text: string; color: string; title?: string }[] = [];
    if (v && !sees.has(g.id)) tags.push(g.kind === "tab" ? { text: "needs app", color: "var(--amber)", title: "A tab only works when its app is on." } : { text: "blocked by app rule", color: "var(--amber)", title: g.note ?? undefined });
    if (!v && sees.has(g.id)) tags.push({ text: "has it anyway", color: "var(--text-dim)", title: person.isOwner ? "The owner has everything." : "Admins or everyone get this without a grant." });
    if (person.rows[g.id]?.auto) tags.push({ text: "auto", color: "var(--text-muted)", title: "Set by the Discord team sync." });
    if (g.kind === "tab" && !g.enforced) tags.push({ text: "not enforced yet", color: "var(--text-muted)", title: g.note ?? "The app still uses its own gate." });
    return (
      <button key={g.id} type="button" role="switch" aria-checked={v} className={`ax-row${g.kind === "tab" ? " ax-row-tab" : ""}`}
        data-staged={isStaged} disabled={!!locked} onClick={() => setStaged((s) => toggled(person, s, g.id))}>
        <span className="ax-switch" data-on={v} aria-hidden />
        {icon && <span style={{ width: 18, textAlign: "center" }} aria-hidden>{icon}</span>}
        <span style={{ flex: 1, minWidth: 0, fontSize: g.kind === "tab" ? 11 : 12, fontWeight: g.kind === "app" ? 600 : 400, color: g.kind === "tab" ? "var(--text-dim)" : "var(--text)" }}>
          {g.kind === "tab" ? g.label.replace(/^.*?:\s*/, "") : g.label}
        </span>
        <span style={{ display: "inline-flex", flexWrap: "wrap", gap: 4, justifyContent: "flex-end" }}>
          {isStaged && <span className="ax-badge" style={{ color: "var(--amber)" }}>{storedOf(person, g.id) ? "on" : "off"} → {v ? "on" : "off"}</span>}
          {tags.map((t) => <span key={t.text} className="ax-badge" style={{ color: t.color }} title={t.title}>{t.text}</span>)}
        </span>
      </button>
    );
  };

  return (
    <div>
      <button className="ax-btn ax-back" onClick={onBack} style={{ marginBottom: 12 }}>← People</button>
      <div className="ax-card" style={{ padding: 14, marginBottom: 12, display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12 }}>
        <Avatar url={person.avatarUrl} size={40} />
        <div style={{ flex: "1 1 160px", minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 700, overflowWrap: "anywhere" }}>{person.username}</div>
          <div style={{ marginTop: 4 }}><Badges p={person} /></div>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, flex: "1 1 220px", justifyContent: "flex-end" }}>
          <select className="ax-input" value="" disabled={!!locked || state.presets.length === 0} onChange={(e) => fillPreset(e.target.value)} aria-label="Fill from preset" style={{ flex: "1 1 160px", maxWidth: 240 }}>
            <option value="">{state.presets.length ? "Fill from preset..." : "No presets yet"}</option>
            {state.presets.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <button className="ax-btn" onClick={showHistory}>History</button>
        </div>
      </div>
      {locked && <Box kind="info">{locked}</Box>}
      {presetMsg && <Box kind="warn">{presetMsg}</Box>}
      <div className="ax-detail">
        <div className="ax-card">
          {groups.map((grp) => grp.apps.length > 0 && (
            <div key={grp.section.id}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 12px 8px" }}>
                <span style={{ width: 3, height: 14, background: grp.section.color }} />
                <span className="ax-label" style={{ color: "var(--text)" }}>{grp.section.name}</span>
              </div>
              {grp.apps.map((a) => [row(a.grant, a.icon), ...a.tabs.map((t) => row(t))])}
            </div>
          ))}
        </div>
        <PreviewPanel catalog={state.catalog} preview={preview} fallback={person.sees} staged={n > 0} error={previewError} />
      </div>
      {n > 0 && (
        <div className="ax-bar">
          <div className="ax-bar-inner">
            <span style={{ fontSize: 11, color: "var(--amber)", fontWeight: 700 }}>{n} unsaved {n === 1 ? "change" : "changes"} for {person.username}</span>
            <input className="ax-input" placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} aria-label="Note" style={{ flex: "1 1 200px" }} />
            <button className="ax-btn" onClick={() => { setStaged({}); setPresetMsg(null); setError(null); }} disabled={saving}>Discard</button>
            <button className="ax-btn ax-btn-primary" onClick={save} disabled={saving}>{saving ? "Saving..." : "Save"}</button>
            {error && <span role="alert" style={{ flexBasis: "100%", fontSize: 11, color: "var(--red)" }}>Not saved: {error}</span>}
          </div>
        </div>
      )}
    </div>
  );
}

function PreviewPanel({ catalog, preview, fallback, staged, error }: {
  catalog: Grant[]; preview: { now: string[]; after: string[] } | null; fallback: string[]; staged: boolean; error: string | null;
}) {
  const now = new Set(preview?.now ?? fallback);
  const after = new Set(preview?.after ?? fallback);
  const shown = catalog.filter((g) => now.has(g.id) || after.has(g.id));
  return (
    <aside className="ax-card" style={{ padding: 14 }} aria-label="What they can see">
      <div className="ax-label" style={{ marginBottom: 4 }}>What they can see</div>
      <div style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 10 }}>{staged ? "After you save. Same rule Portal uses." : "Right now. Same rule Portal uses."}</div>
      {error && <Box kind="error">Preview failed: {error}</Box>}
      {!preview && !error && <div style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 6 }}>Checking...</div>}
      {shown.length === 0 ? <div style={{ fontSize: 11, color: "var(--text-dim)" }}>Nothing. They see only locked tiles.</div> : (
        <ul style={{ listStyle: "none", margin: 0, padding: 0, fontSize: 11, lineHeight: 1.9 }}>
          {shown.map((g) => {
            const gain = after.has(g.id) && !now.has(g.id);
            const lose = now.has(g.id) && !after.has(g.id);
            return (
              <li key={g.id} style={{ paddingLeft: g.kind === "tab" ? 16 : 0, color: lose ? "var(--red)" : gain ? "var(--green)" : g.kind === "tab" ? "var(--text-dim)" : "var(--text)", textDecoration: lose ? "line-through" : "none" }}>
                {gain ? "+ " : lose ? "- " : g.kind === "tab" ? "· " : ""}{g.label}
              </li>
            );
          })}
        </ul>
      )}
    </aside>
  );
}

// ---------- matrix ----------

function MatrixView({ state, list, manage, onSaved }: {
  state: State; list: Person[]; manage: boolean; onSaved: (changeId: string | null, n: number) => Promise<void>;
}) {
  const [staged, setStaged] = useState<Record<string, Staged>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [dry, setDry] = useState<DryPerson[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const apps = state.catalog.filter((g) => g.kind === "app");
  const tabsOf = (id: string) => state.catalog.filter((g) => g.kind === "tab" && g.app === id);
  const cols = apps.flatMap((a) => [a, ...(expanded.has(a.id) ? tabsOf(a.id) : [])]);
  const byId = new Map(state.people.map((p) => [p.id, p]));
  const n = Object.values(staged).reduce((s, x) => s + Object.keys(x).length, 0);
  const peopleN = Object.values(staged).filter((x) => Object.keys(x).length > 0).length;
  const items = () => Object.entries(staged).filter(([, s]) => Object.keys(s).length).map(([id, s]) => itemOf(byId.get(id)!, s));

  const flip = (p: Person, id: string) => setStaged((all) => ({ ...all, [p.id]: toggled(p, all[p.id] ?? {}, id) }));
  const flipExpand = (id: string) => setExpanded((s) => { const x = new Set(s); if (x.has(id)) x.delete(id); else x.add(id); return x; });
  const review = async () => {
    setBusy(true); setError(null);
    try {
      setDry((await api<{ people: DryPerson[] }>("/api/access/admin/changes", { method: "POST", body: { items: items(), dryRun: true } })).people);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const save = async () => {
    setBusy(true); setError(null);
    try {
      const r = await api<{ changeId: string | null; count: number }>("/api/access/admin/changes", { method: "POST", body: { items: items(), note } });
      setDry(null); setStaged({}); setNote("");
      await onSaved(r.changeId, r.count);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const label = (id: string) => state.catalog.find((g) => g.id === id)?.label ?? id;
  const cellTitle = (p: Person, g: Grant, v: boolean) =>
    `${p.username} · ${g.label}: ${v ? "on" : "off"}${!v && p.sees.includes(g.id) ? " (has it anyway)" : ""}${p.lockedReason && manage ? ` · ${p.lockedReason}` : ""}`;

  return (
    <div>
      <div style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 8 }}>
        Click cells to stage changes. Nothing is saved until you review and save. ★ = has it anyway (admin, owner or open to everyone).
      </div>
      {list.length === 0 ? <div className="ax-card"><Empty>Nobody matches. Clear the search or pick another filter.</Empty></div> : (
        <>
          <div className="ax-matrix-wrap">
            <table className="ax-matrix">
              <thead>
                <tr>
                  <th className="ax-sticky">Person</th>
                  {cols.map((g) => (
                    <th key={g.id} className={g.kind === "tab" ? "ax-tabcol" : undefined} title={g.label}>
                      <div style={{ overflow: "hidden", textOverflow: "ellipsis", color: g.kind === "tab" ? "var(--text-muted)" : undefined }}>
                        {g.kind === "tab" ? g.label.replace(/^.*?:\s*/, "") : g.label}
                      </div>
                      {g.kind === "app" && tabsOf(g.id).length > 0 && (
                        <button className="ax-btn" style={{ marginTop: 4, padding: "2px 6px", minHeight: 22, fontSize: 9 }} onClick={() => flipExpand(g.id)} aria-expanded={expanded.has(g.id)}>
                          {expanded.has(g.id) ? "− tabs" : `+ ${tabsOf(g.id).length} tabs`}
                        </button>
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {list.map((p) => (
                  <tr key={p.id}>
                    <td className="ax-sticky">
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <Avatar url={p.avatarUrl} size={20} />
                        <span style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.username}</span>
                      </div>
                    </td>
                    {cols.map((g) => {
                      const v = valueOf(p, staged[p.id], g.id);
                      const isStaged = !!staged[p.id] && g.id in staged[p.id];
                      return (
                        <td key={g.id} className={g.kind === "tab" ? "ax-tabcol" : undefined}>
                          <button className="ax-cell" data-on={v} data-staged={isStaged} disabled={!manage || !!p.lockedReason}
                            title={cellTitle(p, g, v)} aria-label={cellTitle(p, g, v)} onClick={() => flip(p, g.id)}>
                            {v ? "✓" : p.sees.includes(g.id) ? "★" : "·"}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="ax-matrix-list">
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
              {apps.filter((a) => tabsOf(a.id).length).map((a) => (
                <button key={a.id} className="ax-btn" onClick={() => flipExpand(a.id)} aria-expanded={expanded.has(a.id)}>
                  {expanded.has(a.id) ? `Hide ${a.label} tabs` : `Show ${a.label} tabs`}
                </button>
              ))}
            </div>
            {list.map((p) => (
              <div key={p.id} className="ax-card" style={{ padding: 12, marginBottom: 10 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                  <Avatar url={p.avatarUrl} size={24} />
                  <span style={{ fontWeight: 700, fontSize: 12, flex: 1, minWidth: 0, overflowWrap: "anywhere" }}>{p.username}</span>
                  <Badges p={p} />
                </div>
                {p.lockedReason && manage && <div style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 6 }}>Locked: {p.lockedReason}</div>}
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {cols.map((g) => {
                    const v = valueOf(p, staged[p.id], g.id);
                    const isStaged = !!staged[p.id] && g.id in staged[p.id];
                    return (
                      <button key={g.id} className="ax-chip" data-on={v} data-staged={isStaged} disabled={!manage || !!p.lockedReason}
                        aria-pressed={v} onClick={() => flip(p, g.id)}>
                        {v ? "✓" : p.sees.includes(g.id) ? "★" : "·"} {g.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
      {n > 0 && !dry && (
        <div className="ax-bar">
          <div className="ax-bar-inner">
            <span style={{ fontSize: 11, color: "var(--amber)", fontWeight: 700 }}>{n} unsaved {n === 1 ? "change" : "changes"} for {peopleN} {peopleN === 1 ? "person" : "people"}</span>
            <span style={{ flex: 1 }} />
            <button className="ax-btn" onClick={() => setStaged({})} disabled={busy}>Discard</button>
            <button className="ax-btn ax-btn-primary" onClick={review} disabled={busy}>{busy ? "Checking..." : "Review and save"}</button>
            {error && <span role="alert" style={{ flexBasis: "100%", fontSize: 11, color: "var(--red)" }}>{error}</span>}
          </div>
        </div>
      )}
      {dry && (
        <div className="ax-overlay" role="dialog" aria-modal="true" aria-label="Check before saving">
          <div className="ax-dialog ax-card" style={{ padding: 18, background: "var(--bg-surface)" }}>
            <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.15em", textTransform: "uppercase", color: "var(--amber)", marginBottom: 6 }}>Check before saving</div>
            <div style={{ fontSize: 12, marginBottom: 14 }}>These {n} {n === 1 ? "change" : "changes"} for {dry.length} {dry.length === 1 ? "person" : "people"}. One Undo reverts all of them.</div>
            {dry.some((d) => d.changes.some((c) => c.stale)) && <Box kind="warn">Someone changed some of these since you loaded the page. Saving will be refused; discard and reload.</Box>}
            <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 14 }}>
              {dry.map((d) => (
                <div key={d.userId} style={{ border: "1px solid var(--border)", padding: 10 }}>
                  <div style={{ fontWeight: 700, fontSize: 12, marginBottom: 6 }}>{d.username}</div>
                  <ul style={{ listStyle: "none", margin: 0, padding: 0, fontSize: 11, lineHeight: 1.8 }}>
                    {d.changes.map((c) => (
                      <li key={c.grantId} style={{ color: c.stale ? "var(--amber)" : "var(--text-dim)" }}>
                        {label(c.grantId)}: {onOff(c.from)} → <span style={{ color: c.to ? "var(--green)" : "var(--red)" }}>{onOff(c.to)}</span>{c.stale ? " (changed since)" : ""}
                      </li>
                    ))}
                  </ul>
                  {(d.gains.length > 0 || d.loses.length > 0) ? (
                    <div style={{ fontSize: 10, marginTop: 6, lineHeight: 1.7 }}>
                      {d.gains.length > 0 && <div style={{ color: "var(--green)" }}>Can now open: {d.gains.map(label).join(", ")}</div>}
                      {d.loses.length > 0 && <div style={{ color: "var(--red)" }}>Can no longer open: {d.loses.map(label).join(", ")}</div>}
                    </div>
                  ) : <div style={{ fontSize: 10, marginTop: 6, color: "var(--text-muted)" }}>What they can open does not change.</div>}
                </div>
              ))}
            </div>
            <input className="ax-input" placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} aria-label="Note" style={{ width: "100%", marginBottom: 12 }} />
            {error && <Box kind="error">Not saved: {error}</Box>}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
              <button className="ax-btn" onClick={() => { setDry(null); setError(null); }} disabled={busy}>Back</button>
              <button className="ax-btn ax-btn-primary" onClick={save} disabled={busy}>{busy ? "Saving..." : `Save ${n} ${n === 1 ? "change" : "changes"}`}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------- audit log ----------

function plainRefusal(msg: string, label: (id: string) => string): string {
  if (/already reverted/.test(msg)) return "Already undone.";
  const m = msg.match(/^(.*) changed since$/);
  if (m) return `${label(m[1])} changed after this. Undo the newer change first.`;
  if (/user is gone/.test(msg)) return "That person no longer exists.";
  if (/pre-grant/.test(msg)) return "Pre-grants by email cannot be undone here.";
  return msg.charAt(0).toUpperCase() + msg.slice(1) + ".";
}

function AuditView({ people, catalog, manage, personFilter, setPersonFilter, onUndone }: {
  people: Person[]; catalog: Grant[]; manage: boolean; personFilter: string; setPersonFilter: (id: string) => void; onUndone: () => Promise<void>;
}) {
  const [actor, setActor] = useState("");
  const [changes, setChanges] = useState<Change[] | null>(null);
  const [more, setMore] = useState(false);
  const [page, setPage] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [undoErr, setUndoErr] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const fetchPage = useCallback(async (p: number) => {
    const sp = new URLSearchParams({ page: String(p) });
    if (personFilter) sp.set("person", personFilter);
    if (actor) sp.set("actor", actor);
    return api<{ changes: Change[]; more: boolean }>(`/api/access/admin/audit?${sp}`);
  }, [personFilter, actor]);

  const reload = useCallback(async () => {
    try {
      setError(null);
      const r = await fetchPage(0);
      setChanges(r.changes); setMore(r.more); setPage(0);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [fetchPage]);
  useEffect(() => { setChanges(null); reload(); }, [reload]);

  const loadMore = async () => {
    try {
      const r = await fetchPage(page + 1);
      setChanges((c) => [...(c ?? []), ...r.changes]); setMore(r.more); setPage(page + 1);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const undo = async (c: Change) => {
    setBusy(c.changeId);
    setUndoErr((u) => { const x = { ...u }; delete x[c.changeId]; return x; });
    try {
      await api("/api/access/admin/revert", { method: "POST", body: { changeId: c.changeId } });
      await Promise.all([reload(), onUndone()]);
    } catch (e) {
      setUndoErr((u) => ({ ...u, [c.changeId]: plainRefusal((e as Error).message, (id) => catalog.find((g) => g.id === id)?.label ?? id) }));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 14 }}>
        <select className="ax-input" value={personFilter} onChange={(e) => setPersonFilter(e.target.value)} aria-label="Filter by person" style={{ flex: "1 1 200px" }}>
          <option value="">Any person changed</option>
          {people.map((p) => <option key={p.id} value={p.id}>{p.username}</option>)}
        </select>
        <select className="ax-input" value={actor} onChange={(e) => setActor(e.target.value)} aria-label="Filter by who changed it" style={{ flex: "1 1 200px" }}>
          <option value="">Changed by anyone</option>
          {people.filter((p) => p.isAdmin || p.isAccessAdmin).map((p) => <option key={p.id} value={p.id}>{p.username}</option>)}
        </select>
      </div>
      {error && <Box kind="error">Could not load the log: {error} <button className="ax-btn" onClick={reload} style={{ marginLeft: 8 }}>Try again</button></Box>}
      {!changes && !error ? <div className="ax-card"><Empty>Loading the log...</Empty></div> : changes && changes.length === 0 ? (
        <div className="ax-card"><Empty>No changes yet{personFilter || actor ? " for this filter" : ""}.</Empty></div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {changes?.map((c) => (
            <div key={c.changeId} className="ax-card" style={{ padding: 12, opacity: c.undoneAt ? 0.7 : 1 }}>
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "6px 10px", marginBottom: 8 }}>
                <span style={{ fontSize: 11, fontWeight: 700 }}>{when(c.at)}</span>
                <span style={{ fontSize: 11, color: "var(--text-dim)" }}>by {c.by}</span>
                {c.rows.length > 1 && <span className="ax-badge" style={{ color: "var(--text-dim)" }}>{c.rows.length} changes</span>}
                {c.isUndo && <span className="ax-badge" style={{ color: "var(--accent)" }}>Undo{c.undoOfAt ? ` of ${when(c.undoOfAt)}` : ""}</span>}
                {c.undoneAt && <span className="ax-badge" style={{ color: "var(--text-muted)" }}>Undone {when(c.undoneAt)} by {c.undoneBy}</span>}
                <span style={{ flex: 1 }} />
                {manage && !c.undoneAt && !c.pending && (
                  <button className="ax-btn" onClick={() => undo(c)} disabled={busy === c.changeId}>{busy === c.changeId ? "Undoing..." : "Undo"}</button>
                )}
              </div>
              <ul style={{ listStyle: "none", margin: 0, padding: 0, fontSize: 11, lineHeight: 1.8 }}>
                {c.rows.map((r, i) => (
                  <li key={i} style={{ overflowWrap: "anywhere" }}>
                    <span style={{ fontWeight: 600 }}>{r.person}</span>
                    <span style={{ color: "var(--text-dim)" }}> · {r.grant}: {stateWord(r.from)} → </span>
                    <span style={{ color: r.to === "on" ? "var(--green)" : r.to === "off" ? "var(--red)" : "var(--text-dim)" }}>{stateWord(r.to)}</span>
                  </li>
                ))}
              </ul>
              {c.note && <div style={{ fontSize: 10, color: "var(--text-dim)", marginTop: 6 }}>Note: {c.note}</div>}
              {undoErr[c.changeId] && <div role="alert" style={{ fontSize: 11, color: "var(--red)", marginTop: 6 }}>Undo refused: {undoErr[c.changeId]}</div>}
            </div>
          ))}
          {more && <button className="ax-btn" onClick={loadMore} style={{ alignSelf: "center" }}>Load more</button>}
        </div>
      )}
    </div>
  );
}

// ---------- pre-grants ----------

function PendingView() {
  const [rows, setRows] = useState<PendingRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try { setError(null); setRows((await api<{ pending: PendingRow[] }>("/api/access/admin/pending")).pending); } catch (e) { setError((e as Error).message); }
  }, []);
  useEffect(() => { load(); }, [load]);
  const color = (s: string) => (s === "applied" ? "var(--green)" : s.startsWith("waiting") ? "var(--amber)" : "var(--text-muted)");
  return (
    <div>
      <div style={{ fontSize: 11, color: "var(--text-dim)", marginBottom: 12, lineHeight: 1.6 }}>
        Access set by email before the person signs in. It applies when they sign in with Discord and Discord says the email is verified.
        People who signed in before this check wait until they sign in again. Add or remove pre-grants on the old admin page.
      </div>
      {error ? <Box kind="error">Could not load pre-grants: {error} <button className="ax-btn" onClick={load} style={{ marginLeft: 8 }}>Try again</button></Box>
        : !rows ? <div className="ax-card"><Empty>Loading pre-grants...</Empty></div>
        : rows.length === 0 ? <div className="ax-card"><Empty>No pre-grants by email.</Empty></div> : (
          <div className="ax-card">
            {rows.map((r) => (
              <div key={r.id} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "4px 12px", padding: "10px 12px", borderTop: "1px solid var(--border)", fontSize: 11 }}>
                <span style={{ fontWeight: 600, flex: "1 1 200px", overflowWrap: "anywhere" }}>{r.email}</span>
                <span style={{ flex: "1 1 160px", color: "var(--text-dim)" }}>{r.grantLabel}: {onOff(r.granted)}</span>
                <span className="ax-badge" style={{ color: color(r.status) }}>{r.status}</span>
                <span style={{ flex: "1 1 100%", fontSize: 10, color: "var(--text-muted)" }}>
                  Set {when(r.createdAt)}{r.by ? ` by ${r.by}` : ""}{r.person ? ` · ${r.status === "applied" ? "applied to" : "matches"} ${r.person}` : ""}{r.resolvedAt ? ` · ${when(r.resolvedAt)}` : ""}
                </span>
              </div>
            ))}
          </div>
        )}
    </div>
  );
}

// ---------- presets ----------

function PresetsView({ state, manage, reload, notify }: { state: State; manage: boolean; reload: () => Promise<void>; notify: (t: string) => void }) {
  const [editing, setEditing] = useState<{ id: string | null; name: string; description: string; grantIds: Set<string> } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDel, setConfirmDel] = useState<string | null>(null);
  const groups = useMemo(() => groupsOf(state.catalog), [state.catalog]);
  const label = (id: string) => state.catalog.find((g) => g.id === id)?.label ?? id;

  const save = async () => {
    if (!editing) return;
    setBusy(true); setError(null);
    const body = { name: editing.name, description: editing.description, grantIds: [...editing.grantIds] };
    try {
      if (editing.id) await api(`/api/access/admin/presets/${editing.id}`, { method: "PATCH", body });
      else await api("/api/access/admin/presets", { method: "POST", body });
      setEditing(null);
      await reload();
      notify("Preset saved. Nobody's access changed.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const del = async (id: string) => {
    setBusy(true); setError(null);
    try {
      await api(`/api/access/admin/presets/${id}`, { method: "DELETE" });
      setConfirmDel(null);
      await reload();
      notify("Preset deleted. Nobody's access changed.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const flip = (id: string) => setEditing((e) => {
    if (!e) return e;
    const g = new Set(e.grantIds);
    if (g.has(id)) g.delete(id); else g.add(id);
    return { ...e, grantIds: g };
  });

  return (
    <div>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, marginBottom: 12 }}>
        <div style={{ fontSize: 11, color: "var(--text-dim)", flex: "1 1 280px", lineHeight: 1.6 }}>
          A preset is a list of apps and tabs. On a person&apos;s page it only fills the toggles. Editing or deleting a preset never changes anyone.
        </div>
        {manage && !editing && <button className="ax-btn ax-btn-primary" onClick={() => setEditing({ id: null, name: "", description: "", grantIds: new Set() })}>New preset</button>}
      </div>
      {error && <Box kind="error">{error}</Box>}
      {editing && (
        <div className="ax-card" style={{ padding: 14, marginBottom: 14 }}>
          <div className="ax-label" style={{ marginBottom: 8 }}>{editing.id ? "Edit preset" : "New preset"}</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
            <input className="ax-input" placeholder="Name, e.g. Editor" value={editing.name} maxLength={60} onChange={(e) => setEditing({ ...editing, name: e.target.value })} aria-label="Preset name" style={{ flex: "1 1 180px" }} />
            <input className="ax-input" placeholder="What it is for (optional)" value={editing.description} maxLength={200} onChange={(e) => setEditing({ ...editing, description: e.target.value })} aria-label="Preset description" style={{ flex: "2 1 240px" }} />
          </div>
          <div style={{ border: "1px solid var(--border)" }}>
            {groups.map((grp) => grp.apps.map((a) => [a.grant, ...a.tabs].map((g) => (
              <button key={g.id} type="button" role="switch" aria-checked={editing.grantIds.has(g.id)} className={`ax-row${g.kind === "tab" ? " ax-row-tab" : ""}`} onClick={() => flip(g.id)}>
                <span className="ax-switch" data-on={editing.grantIds.has(g.id)} aria-hidden />
                <span style={{ fontSize: g.kind === "tab" ? 11 : 12, color: g.kind === "tab" ? "var(--text-dim)" : "var(--text)" }}>{g.label}</span>
              </button>
            ))))}
          </div>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 12 }}>
            <button className="ax-btn" onClick={() => { setEditing(null); setError(null); }} disabled={busy}>Cancel</button>
            <button className="ax-btn ax-btn-primary" onClick={save} disabled={busy || !editing.name.trim()}>{busy ? "Saving..." : "Save preset"}</button>
          </div>
        </div>
      )}
      {state.presets.length === 0 ? <div className="ax-card"><Empty>No presets yet.{manage ? " Make one with New preset." : ""}</Empty></div> : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 300px), 1fr))", gap: 10 }}>
          {state.presets.map((p) => (
            <div key={p.id} className="ax-card" style={{ padding: 14 }}>
              <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 4 }}>{p.name}</div>
              {p.description && <div style={{ fontSize: 11, color: "var(--text-dim)", marginBottom: 8 }}>{p.description}</div>}
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 10 }}>
                {p.grantIds.length === 0 ? <span style={{ fontSize: 10, color: "var(--text-muted)" }}>No apps</span> : p.grantIds.map((g) => <span key={g} className="ax-badge" style={{ color: "var(--text-dim)" }}>{label(g)}</span>)}
              </div>
              <div style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: manage ? 10 : 0 }}>Updated {when(p.updatedAt)}{p.by ? ` · made by ${p.by}` : ""}</div>
              {manage && (
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button className="ax-btn" onClick={() => { setConfirmDel(null); setEditing({ id: p.id, name: p.name, description: p.description ?? "", grantIds: new Set(p.grantIds) }); }}>Edit</button>
                  {confirmDel === p.id ? (
                    <>
                      <button className="ax-btn ax-btn-danger" onClick={() => del(p.id)} disabled={busy}>Yes, delete</button>
                      <button className="ax-btn" onClick={() => setConfirmDel(null)}>Keep</button>
                    </>
                  ) : <button className="ax-btn ax-btn-danger" onClick={() => setConfirmDel(p.id)}>Delete</button>}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------- access admins ----------

function AdminsView({ people, isOwner, reload, notify }: { people: Person[]; isOwner: boolean; reload: () => Promise<void>; notify: (t: string, error?: boolean) => void }) {
  const [pick, setPick] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<string | null>(null);
  const owner = people.filter((p) => p.isOwner);
  const admins = people.filter((p) => p.isAccessAdmin && !p.isOwner);
  const set = async (userId: string, on: boolean) => {
    setBusy(true);
    try {
      await api("/api/access/admin/admins", { method: "POST", body: { userId, on } });
      setPick(""); setConfirm(null);
      await reload();
      notify(on ? "Access admin added." : "Access admin removed.");
    } catch (e) {
      notify((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  };
  const line = (p: Person, removable: boolean) => (
    <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderTop: "1px solid var(--border)", flexWrap: "wrap" }}>
      <Avatar url={p.avatarUrl} size={28} />
      <span style={{ fontWeight: 600, fontSize: 12, flex: 1, minWidth: 0 }}>{p.username}</span>
      <Badges p={p} />
      {removable && isOwner && (confirm === p.id ? (
        <>
          <button className="ax-btn ax-btn-danger" onClick={() => set(p.id, false)} disabled={busy}>Yes, remove</button>
          <button className="ax-btn" onClick={() => setConfirm(null)}>Keep</button>
        </>
      ) : <button className="ax-btn ax-btn-danger" onClick={() => setConfirm(p.id)}>Remove</button>)}
    </div>
  );
  return (
    <div style={{ maxWidth: 720 }}>
      <div style={{ fontSize: 11, color: "var(--text-dim)", marginBottom: 12, lineHeight: 1.6 }}>
        Access admins can change anyone&apos;s access except the owner&apos;s and their own. Only the owner adds or removes them. Every change is in the audit log.
      </div>
      <div className="ax-card" style={{ marginBottom: 14 }}>
        {owner.map((p) => line(p, false))}
        {admins.length === 0 ? <Empty>No access admins yet.</Empty> : admins.map((p) => line(p, true))}
      </div>
      {isOwner ? (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          <select className="ax-input" value={pick} onChange={(e) => setPick(e.target.value)} aria-label="Person to make access admin" style={{ flex: "1 1 220px" }}>
            <option value="">Pick a person...</option>
            {people.filter((p) => !p.isAccessAdmin && !p.isOwner).map((p) => <option key={p.id} value={p.id}>{p.username}</option>)}
          </select>
          <button className="ax-btn ax-btn-primary" disabled={!pick || busy} onClick={() => set(pick, true)}>Make access admin</button>
        </div>
      ) : <div style={{ fontSize: 10, color: "var(--text-muted)" }}>Only the owner can change this list.</div>}
    </div>
  );
}
