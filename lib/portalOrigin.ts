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
 * Order: the forwarded host Caddy sets (Caddy overwrites any value a client sends), then AUTH_URL
 * (direct requests to 127.0.0.1:3002), and the request's own origin only for `next dev` without
 * AUTH_URL, where it is the real localhost address.
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
