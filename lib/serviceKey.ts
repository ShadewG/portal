import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Shared secret for server-to-server access checks (R-2159 M4). Apps on the same host (Pulse hiring desk, later the
 * other Pulse desks) send it in the X-Portal-Access-Key header. The secret lives only in 600 env files on both sides.
 * Missing or short env value = not configured = every answer false (fails closed).
 */
export const SERVICE_KEY_ENV = "PORTAL_ACCESS_CHECK_SECRET";
export const SERVICE_KEY_HEADER = "x-portal-access-key";
const MIN_LENGTH = 32;

export function serviceKeyConfigured(): boolean {
  return (process.env[SERVICE_KEY_ENV] ?? "").length >= MIN_LENGTH;
}

/** Constant time: both sides are hashed to 32 bytes first, so length differences leak nothing either. */
export function serviceKeyOk(given: string | null | undefined): boolean {
  const want = process.env[SERVICE_KEY_ENV] ?? "";
  if (want.length < MIN_LENGTH || typeof given !== "string" || given.length === 0 || given.length > 512) return false;
  const a = createHash("sha256").update(given, "utf8").digest();
  const b = createHash("sha256").update(want, "utf8").digest();
  return timingSafeEqual(a, b);
}
