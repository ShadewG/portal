export const FRONTWIND_DUBBING_APP_ID = "frontwind-dubbing";

const allowedDiscordIds = new Set([
  "348547268695162890", // Ray / thfray
  "1518756884453003406", // Ed / ed044426
  "1518972859697991731", // Chris / chris_valentini
  "308596999480147968", // Harald / hareld
  "214430154527735808", // Samuel / shadew_
]);

const allowedUsernames = new Set([
  "ray",
  "thfray",
  "ed044426",
  "chris_valentini",
  "hareld",
  "harald",
  "samuel",
  "shadew_",
]);

export function isFrontwindDubbingAllowed(user: Record<string, unknown> | undefined) {
  const discordId = String(user?.discordId ?? "");
  const username = String(user?.username ?? "").toLowerCase();
  return allowedDiscordIds.has(discordId) || allowedUsernames.has(username);
}
