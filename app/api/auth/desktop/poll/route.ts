import { NextRequest } from "next/server";
import { encode } from "next-auth/jwt";
import { COOKIE, COOKIE_PATH, SESSION_MAX_AGE, forgetPending, ownsPending, secureCookies, sessionCookieName } from "@/lib/desktopSignin";

/** GET /api/auth/desktop/poll: the Desk app's window asks whether the browser approved its sign-in. Approved: the
 *  Portal session cookie is set on this answer (only the window holding the sign-in's cookie gets it), once. */
export async function GET(req: NextRequest) {
  const raw = req.cookies.get(COOKIE)?.value;
  const e = ownsPending(raw);
  const noStore = { "Cache-Control": "no-store" };
  const clear = `${COOKIE}=; Path=${COOKIE_PATH}; HttpOnly; SameSite=Lax; Max-Age=0${secureCookies() ? "; Secure" : ""}`;
  if (!e) {
    const res = Response.json({ status: "expired" }, { headers: noStore });
    if (raw) res.headers.append("Set-Cookie", clear);
    return res;
  }
  if (e.status === "pending") return Response.json({ status: "pending" }, { headers: noStore });
  forgetPending(e.id);
  if (e.status === "cancelled" || !e.claims) {
    const res = Response.json({ status: "cancelled" }, { headers: noStore });
    res.headers.append("Set-Cookie", clear);
    return res;
  }
  const secret = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET;
  if (!secret) return Response.json({ status: "error", error: "Portal is missing its secret" }, { status: 500, headers: noStore });
  const name = sessionCookieName();
  const token = await encode({ token: e.claims, secret, salt: name, maxAge: SESSION_MAX_AGE });
  const res = Response.json({ status: "done", who: e.who ?? null }, { headers: noStore });
  res.headers.append("Set-Cookie", `${name}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_MAX_AGE}${secureCookies() ? "; Secure" : ""}`);
  res.headers.append("Set-Cookie", clear);
  return res;
}
