import https from "node:https";
import { prisma } from "@/lib/db";
import { isPortalAdmin } from "@/lib/usage";

export const RENDER_FARM_APP_ID = "renderfarm";

/**
 * Server-side client for the render farm PC's portal API (scripts/portal-api.js in
 * ShadewG/render-farm), reached over Tailscale.
 *
 * This server runs with MagicDNS off, so the farm's *.ts.net name resolves to public addresses.
 * Connect to its tailnet IP instead and present the ts.net name for SNI and the Host header;
 * the certificate is still verified against that name.
 */
const HOST = process.env.RENDER_FARM_HOST || "desktop-8ge9o3g.tail495db5.ts.net";
const IP = process.env.RENDER_FARM_IP || "100.98.10.32";
const PORT = Number(process.env.RENDER_FARM_PORT || 8443);
const TIMEOUT_MS = 45_000;

export const FARM_ACTIONS = ["Start", "Pause", "Stop", "Maintenance", "Resume", "Abort"] as const;

export type FarmResponse = { status: number; body: unknown };

export function farmRequest(method: "GET" | "POST", path: string, actor: string, body?: unknown, timeoutMs = TIMEOUT_MS): Promise<FarmResponse> {
  const token = process.env.RENDER_FARM_TOKEN || "";
  if (!token) {
    return Promise.resolve({ status: 503, body: { error: "The portal is not configured with RENDER_FARM_TOKEN" } });
  }
  const payload = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
  return new Promise((resolve) => {
    const req = https.request(
      {
        host: IP,
        port: PORT,
        servername: HOST,
        method,
        path,
        timeout: timeoutMs,
        headers: {
          Host: HOST,
          "X-RF-Portal-Token": token,
          "X-RF-Actor": actor,
          ...(payload ? { "Content-Type": "application/json", "Content-Length": payload.length } : {}),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          let parsed: unknown;
          try {
            parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          } catch {
            parsed = { error: `Render farm answered HTTP ${res.statusCode} without JSON` };
          }
          resolve({ status: res.statusCode || 502, body: parsed });
        });
      },
    );
    req.on("timeout", () => req.destroy(new Error("timed out")));
    req.on("error", (e) => resolve({ status: 502, body: { error: `Render farm unreachable: ${e.message}` } }));
    if (payload) req.write(payload);
    req.end();
  });
}

/** Name recorded in the farm's log for actions taken from the portal. */
export function actorOf(session: unknown): string {
  const user = ((session as { user?: Record<string, unknown> } | null)?.user ?? {}) as Record<string, unknown>;
  return String(user.username || user.name || user.discordId || "portal user");
}

export function farmJson(r: FarmResponse): Response {
  return Response.json(r.body, { status: r.status, headers: { "Cache-Control": "no-store" } });
}

/**
 * Who may use the Render Farm page and its API: portal admins, plus anyone the portal has
 * granted the `renderfarm` app (owner, 24 Sep 2026: Samuel and Austin).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function canUseRenderFarm(session: any): Promise<boolean> {
  if (await isPortalAdmin(session)) return true;
  const discordId = (session?.user as Record<string, unknown> | undefined)?.discordId as string | undefined;
  if (!discordId) return false;
  const dbUser = await prisma.user.findUnique({ where: { discordId } });
  if (!dbUser) return false;
  const grant = await prisma.appAccess.findFirst({ where: { userId: dbUser.id, appId: RENDER_FARM_APP_ID, granted: true } });
  return Boolean(grant);
}
