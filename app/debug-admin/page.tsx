import { auth } from "@/auth";
import { prisma } from "@/lib/db";

export default async function DebugAdmin() {
  const session = await auth();
  const user = session?.user as Record<string, unknown> | undefined;
  const discordId = user?.discordId as string | undefined;

  if (!discordId) return <pre style={{color:'white'}}>Not authenticated</pre>;

  const dbUser = await prisma.user.findUnique({ where: { discordId } });
  const envAdmin = discordId === process.env.ADMIN_DISCORD_ID;

  return (
    <pre style={{ color: "white", padding: 20 }}>
      {JSON.stringify({
        discordId,
        envAdmin,
        ADMIN_DISCORD_ID: process.env.ADMIN_DISCORD_ID,
        match: discordId === process.env.ADMIN_DISCORD_ID,
        dbUser: { id: dbUser?.id, username: dbUser?.username, isAdmin: dbUser?.isAdmin },
        session_isAdmin: user?.isAdmin,
      }, null, 2)}
    </pre>
  );
}
