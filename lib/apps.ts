export interface AppConfig {
  id: string;
  name: string;
  description: string;
  url: string;
  icon: string;
  color: string;
  status: "live" | "dev" | "offline";
  tags: string[];
}

export const apps: AppConfig[] = [
  {
    id: "script-reviewer",
    name: "Script Shield",
    description: "AI-powered true crime script review — legal risk, YouTube policy, and fact-checking pipeline.",
    url: "https://script-reviewer-production.up.railway.app",
    icon: "🛡",
    color: "#ef4444",
    status: "live",
    tags: ["AI", "Legal", "YouTube"],
  },
  {
    id: "foia-researcher",
    name: "FOIA Researcher",
    description: "Automated FOIA request generation, tracking, and document analysis.",
    url: "https://foia-researcher-production.up.railway.app",
    icon: "📋",
    color: "#3b82f6",
    status: "live",
    tags: ["FOIA", "Research", "Docs"],
  },
  {
    id: "finance-app",
    name: "Finance Dashboard",
    description: "Financial tracking, invoicing, and revenue analytics.",
    url: "https://finance-app-production.up.railway.app",
    icon: "💰",
    color: "#22c55e",
    status: "live",
    tags: ["Finance", "Analytics"],
  },
  {
    id: "invoicing",
    name: "Invoicer",
    description: "Invoice generation and payment tracking.",
    url: "https://invoicing-production.up.railway.app",
    icon: "🧾",
    color: "#a855f7",
    status: "live",
    tags: ["Finance", "Invoicing"],
  },
  {
    id: "discord-bot",
    name: "Discord Bot",
    description: "Discord scheduling and automation bot.",
    url: "https://discord.com/channels/@me",
    icon: "🤖",
    color: "#5865f2",
    status: "live",
    tags: ["Discord", "Bot"],
  },
  {
    id: "foia-agent",
    name: "FOIA Bot",
    description: "Autonomous FOIA filing and follow-up agent.",
    url: "https://foia-agent-production.up.railway.app",
    icon: "📡",
    color: "#f59e0b",
    status: "live",
    tags: ["FOIA", "Agent", "AI"],
  },
  {
    id: "moon-bot",
    name: "Moon Bot",
    description: "Automated moon tracking and notifications.",
    url: "https://moon-bot-production.up.railway.app",
    icon: "🌙",
    color: "#6366f1",
    status: "live",
    tags: ["Bot", "Automation"],
  },
  {
    id: "youtube-megaphone",
    name: "YT → Megaphone",
    description: "YouTube to Megaphone podcast uploader pipeline.",
    url: "https://youtube-to-megaphone-production.up.railway.app",
    icon: "🎙",
    color: "#ec4899",
    status: "live",
    tags: ["YouTube", "Podcast"],
  },
];
