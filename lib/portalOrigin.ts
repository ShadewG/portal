import type { NextRequest } from "next/server";

/**
 * The address people use to reach Portal (https://portal.insanity.team), for building absolute
 * links back into Portal from a route handler.
 *
 * Never use req.url or req.nextUrl.origin for that. Portal runs as `next start -H 0.0.0.0 -p 3002`
 * behind Caddy, and Next builds a route handler's request URL from that bind address, so its origin
 * is "https://0.0.0.0:3002" (15 Oct 2026: /desk sent everyone there). middleware.ts is not affected
 * only because next-auth's auth() wrapper swaps in AUTH_URL's origin.
 *
 * Order: x-forwarded-proto/host first. Caddy sets them (overwriting any value a client sends), and
 * `next start` fills them from the Host header when absent, so in practice this is the address the
 * person actually used: portal.insanity.team through Caddy, 127.0.0.1:3002 for a direct request.
 * AUTH_URL and then the request's own origin only matter where nothing set those headers, such as
 * the scripts/check-*.mjs runs.
 */
export function portalOrigin(req: NextRequest): string {
  const forwardedProto = req.headers.get("x-forwarded-proto");
  const forwardedHost = req.headers.get("x-forwarded-host");
  if (forwardedProto && forwardedHost) {
    return `${forwardedProto}://${forwardedHost}`;
  }
  const configured = process.env.AUTH_URL ?? process.env.NEXTAUTH_URL;
  return configured ? new URL(configured).origin : req.nextUrl.origin;
}
