import jwt from "jsonwebtoken";

const SECRET = process.env.PORTAL_JWT_SECRET!;

export interface PortalToken {
  portalUserId: string;
  discordId: string;
  email?: string;
  username?: string;
  avatar?: string;
  isAdmin?: boolean;
  appId: string;
  appUserId?: string;
  iat: number;
  exp: number;
}

/** Generate a short-lived token for cross-app auth (5 min TTL). */
export function signAppToken(payload: {
  portalUserId: string;
  discordId: string;
  email?: string;
  username?: string;
  avatar?: string;
  isAdmin?: boolean;
  appId: string;
  appUserId?: string;
}): string {
  return jwt.sign(payload, SECRET, { expiresIn: "5m" });
}

/** Verify a portal token. Returns null if invalid/expired. */
export function verifyAppToken(token: string): PortalToken | null {
  try {
    return jwt.verify(token, SECRET) as PortalToken;
  } catch {
    return null;
  }
}
