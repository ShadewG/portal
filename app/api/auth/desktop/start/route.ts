import { NextRequest } from "next/server";
import { portalOrigin } from "@/lib/portalOrigin";
import { COOKIE, COOKIE_PATH, TTL_MS, clientIp, secureCookies, startPending } from "@/lib/desktopSignin";

/** POST /api/auth/desktop/start: from Portal's /login inside the Desk app. A sign-in waiting for the browser
 *  (lib/desktopSignin.ts): its code for the window to show, the address for the browser; the secret in a cookie. */
export async function POST(req: NextRequest) {
  const origin = portalOrigin(req);
  if (req.headers.get("origin") !== origin) return Response.json({ error: "Not from Portal" }, { status: 403 });
  if (!/InsanityDesk\//.test(req.headers.get("user-agent") ?? "")) return Response.json({ error: "Only the Insanity Desk app signs in this way" }, { status: 400 });
  const e = startPending(clientIp(req));
  if (!e) return Response.json({ error: "Too many sign-ins waiting. Wait a few minutes and try again." }, { status: 429 });
  const res = Response.json(
    { id: e.id, code: e.code, url: `${origin}/api/auth/desktop/approve?id=${encodeURIComponent(e.id)}`, expiresIn: TTL_MS / 1000 },
    { headers: { "Cache-Control": "no-store" } },
  );
  res.headers.append("Set-Cookie", `${COOKIE}=${e.id}.${e.secret}; Path=${COOKIE_PATH}; HttpOnly; SameSite=Lax; Max-Age=${TTL_MS / 1000}${secureCookies() ? "; Secure" : ""}`);
  return res;
}
