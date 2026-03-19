import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { auth } from "@/auth";

const CANONICAL_HOST = "portal.insanity.team";

export default auth((req: NextRequest) => {
  const host = req.headers.get("host") || "";

  // If running on Railway (old domain), redirect everything to the new domain
  if (host.includes("railway.app") || host.includes("railway.internal")) {
    const url = new URL(req.url);
    url.host = CANONICAL_HOST;
    url.protocol = "https:";
    url.port = "";
    return NextResponse.redirect(url.toString(), 301);
  }
}) as any;

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
