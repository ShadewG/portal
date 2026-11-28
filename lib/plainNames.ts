/**
 * Plain names and one-line "what this is" for every grant a person can be refused (X6, R-3258 B8 + S4).
 * Names follow the naming table in /srv/assistant/reports/tool-plans/UX-PRINCIPLES.md (Home, FOIA Sorter,
 * WorkStation, Training, ...). Used by every Portal screen a person sees: Home tiles, the no-access page, the
 * Requests list and the grant labels on /access (lib/grants.ts). lib/apps.ts `name` stays the system name other
 * apps read through /api/apps (the workspace bar); renaming there waits for the S8 batch with redirects.
 */
export interface Plain { name: string; line: string; holderNote?: string }

const PLAIN: Record<string, Plain> = {
  "pulse": { name: "Pulse", line: "Production numbers, stuck cases and FOIA cases for leads." },
  "renderfarm": { name: "Render Farm", line: "After Effects renders: what is rendering, the queue and failures." },
  "patreon": { name: "Patreon preview", line: "What a Patreon members package looks like." },
  "desk": { name: "Desk", line: "Your day in one place: reviews, projects and the team." },
  "ayoub-private-assistant": { name: "Ayoub Assistant", line: "Ayoub's own assistant." },
  "script-reviewer": { name: "Script Shield", line: "Checks a script for legal risk, YouTube rules and facts." },
  "insanity-extension": { name: "Insanity Extension", line: "Browser extension for production work." },
  "insanity-courses": { name: "Training", line: "Courses and lessons for the team." },
  "frontwind-dubbing": { name: "Frontwind Dubbing", line: "The Frontwind dubbing brief." },
  "cases-dashboard": { name: "Cases", line: "Case pipeline numbers for investors." },
  "kpi": { name: "KPI", line: "The monthly numbers." },
  "foia-researcher": { name: "FOIA Researcher", line: "Writes and tracks FOIA requests." },
  "autobot": { name: "WorkStation", line: "The case workspace: documents, sorting and case work." },
  "police-report-analyzer": { name: "Police Report Analyzer", line: "Reads a police report: names, timeline and red flags." },
  "pd-lookup": { name: "Departments", line: "Police department contacts and FOIA details." },
  "foia-sorter": { name: "FOIA Sorter", line: "Every FOIA case: people, media, timeline and storyboard." },
  "video-review": { name: "Video Review", line: "Watch cuts and leave notes on them." },
  "invoicing": { name: "Invoicing", line: "Send your invoices and see payments." },
  "foia-bot": { name: "FOIA Bot", line: "Old tool that files FOIA requests by itself." },
  "pulse.hiring": {
    name: "Hiring", line: "Trials that wait for your verdict.",
    holderNote: "Hiring shows only the trials where you are the reviewer. When a trial names you, it shows there.",
  },
  "pulse.servers": { name: "Servers", line: "How our servers are doing." },
  "pulse.takedowns": { name: "Takedowns", line: "Copycat uploads to take down." },
  "desk.production": { name: "Production", line: "The production board in Desk." },
  "foia-sorter.distribution": { name: "Distribution", line: "Where each episode is sent: Tubi, Amazon, Roku." },
  "foia-sorter.patreon": { name: "Patreon", line: "Patreon packages in FOIA Sorter." },
  "foia-sorter.podcast": { name: "Podcast", line: "Podcast episodes in FOIA Sorter." },
  "portal.access-admin": { name: "Access page", line: "Give and take access for the team." },
};

/** Parent app of a tab grant id ("pulse.hiring" -> "pulse"). */
const parentOf = (id: string) => (id.includes(".") ? id.slice(0, id.indexOf(".")) : null);

/** Plain name + one line for a grant id; unknown ids fall back to the id itself (never shown for real grants). */
export function plainOf(id: string, fallbackName?: string): Plain {
  return PLAIN[id] ?? { name: fallbackName ?? id, line: "" };
}

/** "Hiring in Pulse" for a tab, the plain name for an app. */
export function plainFull(id: string): string {
  const p = plainOf(id);
  const parent = parentOf(id);
  if (!parent || id === "portal.access-admin" || !PLAIN[parent]) return p.name;
  return `${p.name} in ${PLAIN[parent].name}`;
}

/** What the team calls a person where it differs from the first name in Desk's directory (Discord username -> name).
 *  Used only for "who decides" lines (the access admins). Atom = Dominik on payroll; the team says Atom. */
const CALLED: Record<string, string> = { atomboy7: "Atom" };

/** Short name for a "who decides" line: the team's name for them, else the directory first name, else the handle. */
export function shortName(username: string, realName: string | null): string {
  return CALLED[username.toLowerCase()] ?? (realName ? realName.split(" ")[0] : username);
}
