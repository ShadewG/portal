import fs from "node:fs";
import http from "node:http";

/**
 * Server-side client for Production's MGX route (case-master-server, 127.0.0.1:3058), using the render farm's own key
 * (Samuel 20 Nov 2026: "Give the render farm's Queue Render button its own key to Production? Yes"; 23 Nov: Re-queue on
 * Failed AE cards goes through Production instead of straight to the farm PC).
 *
 * The key lives in a file only user claude can read (one line PRODUCTION_FARM_TOKEN=…); it is read per call and never
 * logged or returned. Production allows this key GET of the queue and POST op render / rendered / status "Needs Render",
 * always for the person who pressed the button (X-Farm-For: their Discord id; they need a Desk profile with edit rights).
 * Production then writes Notion itself and shows the change as "<name> (via Render Farm)".
 */
const TOKEN_FILE = process.env.PRODUCTION_FARM_TOKEN_FILE || "/home/claude/.config/case-master/farm-token";
const PORT = Number(process.env.PRODUCTION_PORT || 3058);
const TIMEOUT_MS = 30_000;

export type ProductionResponse = { status: number; body: unknown };

function farmToken(): string | null {
  try {
    const m = fs.readFileSync(TOKEN_FILE, "utf8").match(/^PRODUCTION_FARM_TOKEN=([A-Za-z0-9_-]{32,})\s*$/m);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

/** True when Portal can reach Production with the farm key (the key file is there and readable). */
export function productionConfigured(): boolean {
  return farmToken() !== null;
}

/** POST /api/production/mgx for the person with this Discord id. Local call only (never through Caddy). */
export function productionMgx(forDiscordId: string, body: unknown): Promise<ProductionResponse> {
  const token = farmToken();
  if (!token) return Promise.resolve({ status: 503, body: { error: "Portal has no render farm key to Production" } });
  const payload = Buffer.from(JSON.stringify(body));
  return new Promise((resolve) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port: PORT,
        method: "POST",
        path: "/api/production/mgx",
        timeout: TIMEOUT_MS,
        headers: {
          Authorization: `Bearer ${token}`,
          "X-Farm-For": forDiscordId,
          "x-cm": "1",
          "Content-Type": "application/json",
          "Content-Length": payload.length,
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
            parsed = { error: `Production answered HTTP ${res.statusCode} without JSON` };
          }
          // never hand the key back, even inside a malformed upstream error
          const s = JSON.stringify(parsed);
          if (s && s.includes(token)) parsed = JSON.parse(s.split(token).join("[redacted]"));
          resolve({ status: res.statusCode || 502, body: parsed });
        });
      },
    );
    req.on("timeout", () => req.destroy(new Error("timed out")));
    req.on("error", (e) => {
      console.error("[renderfarm] Production unreachable:", e.message); // detail stays in the server log
      resolve({ status: 502, body: { error: "Production is not answering. Try again in a minute." } });
    });
    req.write(payload);
    req.end();
  });
}
