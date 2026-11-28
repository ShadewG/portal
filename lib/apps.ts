export interface AppConfig {
  id: string;
  name: string;
  description: string;
  url: string;
  bugReportUrl?: string;
  handoffPath?: string;
  requiresPortalAuth?: boolean;
  allowAnyAuthenticatedUser?: boolean;
  /** X4a (28 Nov 2026): at hand-off, non-admins must be on the Insanity Discord server (lib/teamRule.ts teamMember).
   *  Not a member: "for the team" page. Discord cannot be asked: "try again" page (fail closed). */
  requireGuildMember?: boolean;
  requireExplicitGrant?: boolean;
  allowedDiscordId?: string;
  allowedOrigins?: string[];
  icon: string;
  color: string;
  status: "live" | "dev" | "offline";
}

const localOrigins = [
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "http://localhost:3001",
  "http://127.0.0.1:3001",
];

const insanityOrigins = [
  "https://autobot.insanity.team",
  "https://foiasorter.insanity.team",
  "https://learn.insanity.team",
  "https://portal.insanity.team",
];

export interface AppSection {
  id: string;
  name: string;
  description: string;
  color: string;
  apps: AppConfig[];
}

export const sections: AppSection[] = [
  {
    id: "production",
    name: "Production",
    description: "Content production and review tools",
    color: "#ef4444",
    apps: [
      {
        id: "pulse",
        name: "Pulse",
        description: "Production and team activity.",
        url: "https://pulse.insanity.team",
        handoffPath: "/auth/portal",
        requireExplicitGrant: true,
        allowedOrigins: ["https://pulse.insanity.team"],
        icon: "⌁",
        color: "#75976a",
        status: "live",
      },
      {
        // Owner, 15 Oct 2026: the whole team sees it (lib/renderfarmAccess.ts decides; /api/me, /api/apps and
        // /api/auth/redirect use that rule, not this grant). The grant ticked in /admin now means "may control
        // the farm" (admins always may): owner, 24 Sep 2026, Samuel + Austin.
        id: "renderfarm",
        name: "Render Farm",
        description: "After Effects renders: what is rendering now, the queue, finished renders and failures.",
        url: "https://portal.insanity.team/renderfarm",
        requireExplicitGrant: true,
        icon: "▣",
        color: "#c08a3e",
        status: "live",
      },
      {
        id: "patreon",
        name: "Patreon pilot",
        description: "What a members package looks like — IB30 Daniel Krug, streamed live from Dropbox.",
        url: "https://patreon.insanity.team",
        handoffPath: "/auth/portal",
        allowedOrigins: ["https://patreon.insanity.team"],
        icon: "★",
        color: "#e0332c",
        status: "live",
      },
      {
        id: "desk",
        name: "Desk",
        description: "Your day in one place — reviews, projects, packaging, asks, and the team. Every employee's home.",
        url: "https://desk.insanity.team",
        handoffPath: "/auth/portal",
        requireExplicitGrant: true,
        allowedOrigins: ["https://desk.insanity.team", ...localOrigins, ...insanityOrigins],
        icon: "🗂",
        color: "#3987e5",
        status: "live",
      },
      {
        id: "ayoub-private-assistant",
        name: "Ayoub Assistant",
        description: "Private assistant and build progress.",
        url: "https://ayoub.insanity.team",
        handoffPath: "/api/auth/portal",
        allowedDiscordId: "1033050881798709378",
        allowedOrigins: ["https://ayoub.insanity.team"],
        icon: "A",
        color: "#0f766e",
        status: "live",
      },
      {
        id: "script-reviewer",
        name: "Script Shield",
        description: "AI-powered true crime script review — legal risk, YouTube policy, and fact-checking.",
        url: "https://script-reviewer.insanity.team",
        handoffPath: "/auth/portal",
        allowedOrigins: ["https://script-reviewer.insanity.team", "https://script-reviewer-production.up.railway.app", ...localOrigins, ...insanityOrigins],
        icon: "🛡",
        color: "#ef4444",
        status: "live",
      },
      {
        id: "insanity-extension",
        name: "Insanity Extension",
        description: "Premium browser extension — enhanced production tools and workflow automation.",
        url: "https://insanity-extension.insanity.team",
        handoffPath: "/auth/portal",
        allowedOrigins: ["https://insanity-extension.insanity.team", "https://insanity-extension-production.up.railway.app", ...localOrigins, ...insanityOrigins],
        icon: "⚡",
        color: "#f59e0b",
        status: "live",
      },
      {
        id: "insanity-courses",
        name: "Courses",
        description: "Internal training courses — scripting department lessons, videos, and supporting materials.",
        url: "https://learn.insanity.team",
        handoffPath: "/api/auth/portal",
        allowAnyAuthenticatedUser: true,
        // Samuel, 28 Nov 2026 (Plan: Training E3 fix 6): server members only. Rollback = delete this line.
        requireGuildMember: true,
        allowedOrigins: ["https://learn.insanity.team", ...localOrigins, ...insanityOrigins],
        icon: "🎓",
        color: "#37c2a0",
        status: "live",
      },
      {
        id: "frontwind-dubbing",
        name: "Frontwind Dubbing",
        description: "Confidential Frontwind dubbing operations brief.",
        url: "https://dubbing.insanity.team",
        handoffPath: "/api/auth/portal",
        allowedOrigins: ["https://dubbing.insanity.team", "https://frontwind-brief.insanity.team", "https://frontwind-dubbing.insanity.team", "https://frontwind-ceo.insanity.team", ...localOrigins, ...insanityOrigins],
        icon: "🎙",
        color: "#111827",
        status: "live",
      },
      {
        id: "cases-dashboard",
        name: "Cases",
        description: "Investor-facing case pipeline, production depth, and modeled content demand dashboard.",
        url: "https://cases.insanity.team",
        handoffPath: "/api/auth/portal",
        allowedOrigins: ["https://cases.insanity.team", ...localOrigins],
        icon: "C",
        color: "#0f766e",
        status: "live",
      },
    ],
  },
  {
    id: "foia",
    name: "FOIA",
    description: "Freedom of Information Act tools and automation",
    color: "#3b82f6",
    apps: [
      {
        id: "foia-researcher",
        name: "FOIA Researcher",
        description: "Automated FOIA request generation, tracking, and document analysis.",
        url: "https://foia-researcher.insanity.team",
        handoffPath: "/portal-auth",
        allowedOrigins: ["https://foia-researcher.insanity.team", "https://frontend-app-staging-6be2.up.railway.app", ...localOrigins, ...insanityOrigins],
        icon: "📋",
        color: "#3b82f6",
        status: "live",
      },
      {
        id: "autobot",
        name: "Autobot",
        description: "Automated FOIA processing, document sorting, and case management.",
        url: "https://autobot.insanity.team",
        handoffPath: "/api/auth/portal",
        allowedOrigins: ["https://autobot.insanity.team", "https://autobot.staging.insanity.team", "https://sincere-strength-production.up.railway.app", ...localOrigins, ...insanityOrigins],
        icon: "⚙",
        color: "#22c55e",
        status: "live",
      },
      {
        id: "police-report-analyzer",
        name: "Police Report Analyzer",
        description: "AI analysis of police reports — entity extraction, timeline reconstruction, and red flag detection.",
        url: "https://foia-agent-police-report.up.railway.app",
        handoffPath: "/auth/portal",
        allowedOrigins: ["https://foia-agent-police-report.up.railway.app", ...localOrigins],
        icon: "🔍",
        color: "#8b5cf6",
        status: "live",
      },
      {
        id: "pd-lookup",
        name: "Departments",
        description: "Browse 3,000+ police departments — search contacts, FOIA info, linked cases, and run new lookups.",
        url: "https://foia-researcher.insanity.team/console/departments",
        requiresPortalAuth: false,
        icon: "🚔",
        color: "#0ea5e9",
        status: "live",
      },
      {
        id: "foia-sorter",
        name: "Case Profiles",
        description: "Strategic case profiles — overview, people, media, timeline, and storyboard for every FOIA case.",
        url: "https://foiasorter.insanity.team/app/",
        handoffPath: "/api/auth/portal",
        allowedOrigins: [
          "https://foiasorter.insanity.team",
          "https://foia-review-preview.insanity.team",
          "https://foia-dupe-preview.insanity.team",
          ...localOrigins,
          ...insanityOrigins,
        ],
        icon: "🧩",
        color: "#f97316",
        status: "live",
      },
      {
        // Owner, 13 Nov 2026: Video Review is its own app, for everyone on the Insanity Discord server ("only giving
        // everyone access to review for now ... keep perms as are"). Any signed-in Portal user may start it; Video Review
        // itself checks the person is on the server (review_studio/backend/membership.py) and sends anyone Portal lets
        // into FOIA Sorter on to the Sorter's own sign-in, so nobody gains Sorter or Desk access through this.
        // Its pages live at foiasorter.insanity.team/review/ (review.insanity.team forwards there).
        id: "video-review",
        name: "Video Review",
        description: "Watch cuts, leave timecoded notes and upload new versions. For everyone on the team's Discord server.",
        url: "https://review.insanity.team/",
        handoffPath: "/review/api/auth/portal",
        allowAnyAuthenticatedUser: true,
        allowedOrigins: ["https://review.insanity.team", "https://foiasorter.insanity.team"],
        icon: "▶",
        color: "#22c55e",
        status: "live",
      },
    ],
  },
  {
    id: "hr",
    name: "HR",
    description: "Human resources and administrative tools",
    color: "#a855f7",
    apps: [
      {
        id: "invoicing",
        name: "Front-Lin",
        description: "Invoice generation, payment tracking, and financial records.",
        url: "https://invoicing.insanity.team",
        requiresPortalAuth: false,
        icon: "🧾",
        color: "#a855f7",
        status: "live",
      },
    ],
  },
  {
    id: "archive",
    name: "Archive",
    description: "Retired and legacy tools",
    color: "#64748b",
    apps: [
      {
        id: "foia-bot",
        name: "FOIA Bot",
        description: "Autonomous FOIA filing, follow-up, and status monitoring agent.",
        url: "https://www.foibot.com/login",
        requiresPortalAuth: false,
        icon: "📡",
        color: "#f59e0b",
        status: "live",
      },
    ],
  },
];

export const allApps = sections.flatMap((s) => s.apps);

/** Sign-in only: never listed in the hub, /admin or /api/me, and grants nothing by itself. Any Discord account may
 *  sign in; the app decides what the person sees (Video Review: one review, through a "Discord sign-in" guest link). */
const signInOnlyApps: AppConfig[] = [
  {
    id: "video-review-guest",
    name: "Video Review guest link",
    description: "Discord sign-in for a Video Review guest link.",
    url: "https://foiasorter.insanity.team/review/",
    handoffPath: "/review/api/guest/portal",
    allowAnyAuthenticatedUser: true,
    allowedOrigins: ["https://foiasorter.insanity.team"],
    icon: "▶",
    color: "#5865f2",
    status: "live",
  },
];

export function getAppById(id: string): AppConfig | undefined {
  return allApps.find((a) => a.id === id) ?? signInOnlyApps.find((a) => a.id === id);
}

export function appRequiresPortalAuth(app: AppConfig): boolean {
  return app.requiresPortalAuth !== false;
}

export function getAppHostname(app: AppConfig): string {
  try {
    return new URL(app.url).hostname;
  } catch {
    return app.url;
  }
}

export function getAppEnvironment(app: AppConfig): "production" | "staging" | "development" {
  const hostname = getAppHostname(app).toLowerCase();
  if (hostname.includes("localhost") || hostname.includes("127.0.0.1")) {
    return "development";
  }
  if (hostname.includes("staging")) {
    return "staging";
  }
  return "production";
}

export function getAppBugReportUrl(app: AppConfig): string {
  return app.bugReportUrl ?? app.url;
}
