import { readFile } from "node:fs/promises";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";

// Owner (15 Sep 2026): "when people visit desk.insanity.team they automatically see the page
// linked to their discord profile". The portal already knows who they are — NextAuth with the
// Discord provider puts `discordId` on the session, and middleware.ts has already bounced anyone
// without one to /login. All this route adds is the reviewer's unguessable desk token, read from a
// 0600 map on the same box written by review_desk_portal_map.py.
//
// Owner (17 Sep 2026): a reviewer's link opens only their own desk, but "admins like me can access
// their pages as well if I go to desk" and "make desk homepage browsable for admin so i can easily
// see all stats". An admin (the portal's own isAdmin flag) is sent to the every-desk overview page
// (its token is the "admin" entry in desk-directory.json, written by the same InsanityBot script),
// falling back to a plain list of desks if that page does not exist yet.
const DESK = "https://desk.insanity.team";
const MAP = process.env.DESK_TOKEN_MAP ?? "/opt/apps/review-desk/desk-tokens.json";
const DIRECTORY = process.env.DESK_DIRECTORY ?? "/opt/apps/review-desk/desk-directory.json";

export const dynamic = "force-dynamic";

type Desk = { name: string; reviewer_id: string; token: string };

function escape(text: string) {
  return text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
}

// The same tokens as pulse.insanity.team and the desks themselves — one style, one product.
const STYLE =
  `:root{color-scheme:dark;--page:#0a0c0e;--surface:#111519;--line:#232b33;--line-strong:#303a44;--ink:#eef2f5;--ink-2:#a7b2bc;--ink-3:#79848e;--blue:#3987e5;` +
  `--mono:"IBM Plex Mono",ui-monospace,Consolas,monospace;--sans:system-ui,-apple-system,"Segoe UI",sans-serif}` +
  `*{box-sizing:border-box}body{margin:0;background:var(--page);color:var(--ink);font:14px/1.45 var(--sans)}` +
  `.shell{max-width:720px;margin:0 auto;padding:22px 20px 60px}.eyebrow{font:600 10px/1 var(--mono);letter-spacing:.16em;color:var(--ink-3);text-transform:uppercase}` +
  `h1{font-size:24px;letter-spacing:-.02em;margin:8px 0 16px;font-weight:650}p{color:var(--ink-2);margin:0 0 16px}` +
  `.card{background:var(--surface);border:1px solid var(--line);border-radius:12px;overflow:hidden}` +
  `.row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:12px;align-items:center;padding:12px 16px;border-top:1px solid var(--line)}.row:first-child{border-top:0}` +
  `.row b{display:block;font-weight:600}.row span{display:block;color:var(--ink-3);font-size:11px;margin-top:2px}` +
  `.btn{display:inline-block;border:1px solid var(--blue);background:var(--blue);color:#fff;font:500 11px var(--sans);padding:5px 10px;border-radius:6px;text-decoration:none;white-space:nowrap}` +
  `.btn:hover{background:#4a93ea}.note{color:var(--ink-3);font-size:11.5px;margin-top:16px;line-height:1.5}`;

function page(title: string, body: string, status: number) {
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="robots" content="noindex"><meta name="viewport" content="width=device-width,initial-scale=1">` +
      `<title>${escape(title)}</title><style>${STYLE}</style></head><body><div class="shell">${body}</div></body></html>`,
    { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } },
  );
}

function message(title: string, text: string, status: number) {
  return page(title, `<div class="eyebrow">Dr. Insanity · Review desk</div><h1>${escape(title)}</h1><p>${escape(text)}</p>`, status);
}

async function readJson<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch {
    return null;
  }
}

export async function GET() {
  const session = await auth();
  const user = session?.user as Record<string, unknown> | undefined;
  const discordId = user?.discordId;
  if (!discordId) {
    // Middleware normally prevents this; if it is ever reached, say so rather than 500.
    return message("Review desk", "Sign in to the portal first, then reload this page.", 401);
  }
  // Admin = the env admin, or a user the portal's own admin page has flagged (the same rule
  // /api/admin applies). Samuel signs in as daveslemonade, which is only the latter.
  let isAdmin = user?.isAdmin === true || String(discordId) === process.env.ADMIN_DISCORD_ID;
  if (!isAdmin) {
    try {
      const dbUser = await prisma.user.findFirst({ where: { discordId: String(discordId) }, select: { isAdmin: true } });
      isAdmin = dbUser?.isAdmin === true;
    } catch {
      isAdmin = false;
    }
  }

  if (isAdmin) {
    const desks = await readJson<Desk[]>(DIRECTORY);
    if (!desks) {
      return message("Review desks", "The desk directory is unavailable right now. Try again shortly.", 503);
    }
    // The overview page (every desk's numbers, a button through to each) is the admin's homepage;
    // the plain list below only appears if that page has not been built yet.
    const overview = desks.find((d) => d.reviewer_id === "admin");
    if (overview) {
      return Response.redirect(`${DESK}/${encodeURIComponent(overview.token)}/`, 302);
    }
    const rows = desks
      .filter((d) => d.reviewer_id !== "admin")
      .map(
        (d) =>
          `<div class="row"><div><b>${escape(d.name)}</b><span>rebuilt every 10 minutes · same numbers as the reviewer sees</span></div>` +
          `<a class="btn" href="${DESK}/${encodeURIComponent(d.token)}/">Open desk</a></div>`,
      )
      .join("");
    return page(
      "Review desks",
      `<div class="eyebrow">Dr. Insanity · Review desk</div><h1>Every desk</h1>` +
        `<p>You are signed in as an admin, so this lists everyone's desk. Each reviewer only ever sees their own.</p>` +
        `<div class="card">${rows}</div>` +
        `<div class="note">Each link carries that person's private token — open them, don't forward them. The team table on every desk shows the same numbers side by side.</div>`,
      200,
    );
  }

  const map = await readJson<Record<string, string>>(MAP);
  if (!map) {
    return message("Review desk", "The desk directory is unavailable right now. Try again shortly.", 503);
  }
  const token = map[String(discordId)];
  if (!token) {
    return message("Review desk", "You do not have a review desk. Ask Samuel if you think you should.", 404);
  }
  return Response.redirect(`${DESK}/${token}/`, 302);
}
