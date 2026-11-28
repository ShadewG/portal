import { auth } from "@/auth";
import { deciders, joinOr, noAccessView } from "@/lib/accessRequests";
import AskBox from "./AskBox";
import "../plain.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "No access · Home", robots: { index: false } };

/**
 * The ONE no-access page (X6, R-3258 B8, 28 Nov 2026). Every refusal lands here with ?want=<grant id>: Portal
 * hand-off refusals, the Home "more apps" list, the Pulse gate, Hiring, Takedowns, Servers, /access and /admin.
 * Says what it is (plain name, one line), who decides (the access admins), and one button: "Ask for access"
 * (signed out: "Sign in"). Public in middleware.ts so signed-out people get "Sign in" here, not a bare redirect.
 */
export default async function NoAccessPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const want = typeof sp.want === "string" ? sp.want.slice(0, 80) : "";
  const session = await auth();
  const discordId = (session?.user as { discordId?: unknown } | undefined)?.discordId;
  const signedIn = typeof discordId === "string" && !!discordId;
  const view = signedIn ? await noAccessView(discordId, want) : null;
  const who = view?.deciders ?? (joinOr((await deciders().catch(() => ({ all: [] as string[] }))).all) || "The access admins");
  const self = `/no-access${want ? `?want=${encodeURIComponent(want)}` : ""}`;

  return (
    <div className="pl pl-page">
      <main className="pl-narrow">
        <div className="pl-eyebrow"><a className="pl-link" href="/">Home</a></div>
        {!signedIn ? (
          <>
            <h1>Sign in to continue</h1>
            <p className="pl-dim">This page is for the Dr Insanity team. Sign in with the Discord account you use for the team.</p>
            <div className="pl-row" style={{ marginTop: 20 }}>
              <a className="pl-btn pl-btn-main" href={`/login?callbackUrl=${encodeURIComponent(self)}`}>Sign in</a>
            </div>
          </>
        ) : !view ? (
          <>
            <h1>This page is not open for you</h1>
            <p className="pl-dim">{who} decide who can open what. Ask one of them in Discord if you need it.</p>
            <div className="pl-row" style={{ marginTop: 20 }}>
              <a className="pl-btn pl-btn-main" href="/">Back to Home</a>
            </div>
          </>
        ) : view.has ? (
          <>
            <h1>You have {view.full}</h1>
            <p className="pl-dim">{view.holderNote ?? view.line}</p>
            <div className="pl-row" style={{ marginTop: 20 }}>
              <a className="pl-btn pl-btn-main" href={view.openHref}>Open {view.name}</a>
              <a className="pl-link" href="/">Back to Home</a>
            </div>
          </>
        ) : (
          <AskBox view={view} />
        )}
      </main>
    </div>
  );
}
