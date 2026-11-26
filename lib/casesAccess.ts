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


// Discord id only: usernames are not identity (generic handles like "ray" could be claimed by anyone).
export function isCasesDashboardAllowed(user: Record<string, unknown> | undefined) {
  return allowedDiscordIds.has(String(user?.discordId ?? ""));
}
