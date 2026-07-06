export interface AppConfig {
  id: string;
  name: string;
  description: string;
  url: string;
  bugReportUrl?: string;
  handoffPath?: string;
  requiresPortalAuth?: boolean;
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
        id: "insanity-bot",
        name: "Insanity Bot",
        description: "Discord production bot — scheduling, task management, and workflow automation.",
        url: "https://discord-scheduler.insanity.team",
        handoffPath: "/api/dashboard/auth/portal",
        allowedOrigins: ["https://discord-scheduler.insanity.team", "https://discord-scheduler-production.up.railway.app", ...localOrigins, ...insanityOrigins],
        icon: "🤖",
        color: "#5865f2",
        status: "live",
      },
      {
        id: "video-generation",
        name: "Video Generation",
        description: "AI video generation pipeline — Runway, Kling, and editing automation.",
        url: "https://style-lab.insanity.team",
        handoffPath: "/api/auth/portal",
        allowedOrigins: ["https://style-lab.insanity.team", "https://style-lab-production.up.railway.app", ...localOrigins, ...insanityOrigins],
        icon: "🎬",
        color: "#ec4899",
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
        allowedOrigins: ["https://foiasorter.insanity.team", ...localOrigins, ...insanityOrigins],
        icon: "🧩",
        color: "#f97316",
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
      {
        id: "case-explorer",
        name: "Case Explorer",
        description: "Browse and explore FOIA case files, documents, and frame evidence.",
        url: "https://foiasorter.insanity.team",
        handoffPath: "/api/auth/portal",
        allowedOrigins: ["https://foiasorter.insanity.team", "https://frame-browser-production.up.railway.app", ...localOrigins, ...insanityOrigins],
        icon: "🗂",
        color: "#06b6d4",
        status: "live",
      },
    ],
  },
];

export const allApps = sections.flatMap((s) => s.apps);

export function getAppById(id: string): AppConfig | undefined {
  return allApps.find((a) => a.id === id);
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
