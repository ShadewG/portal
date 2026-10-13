export const CASES_DASHBOARD_APP_ID = "cases-dashboard";

const allowedDiscordIds = new Set([
  "214430154527735808", // Shadew / shadew_
  "1518756884453003406", // Ed / ed044426
  "1518972859697991731", // Chris / chris_valentini
  "308596999480147968", // Harald / hareld
  "1033050881798709378", // Ayoub / ayoub_prods
  "638424868718641152", // Armin / arminnemeth
  "795883279663235072", // Mo / leadership
  "348547268695162890", // Ray / thfray
]);

const allowedUsernames = new Set([
  "shadew_",
  "ed044426",
  "chris_valentini",
  "hareld",
  "harald",
  "ayoub_prods",
  "arminnemeth",
  "ray",
  "thfray",
]);

export function isCasesDashboardAllowed(user: Record<string, unknown> | undefined) {
  const discordId = String(user?.discordId ?? "");
  const username = String(user?.username ?? "").toLowerCase();
  return allowedDiscordIds.has(discordId) || allowedUsernames.has(username);
}
