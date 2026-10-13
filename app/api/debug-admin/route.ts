import { auth } from "@/auth";
import { prisma } from "@/lib/db";

export async function GET() {
  try {
    const session = await auth();
    const user = session?.user as Record<string, unknown> | undefined;
    const discordId = user?.discordId as string | undefined;

    if (!discordId) {
      return Response.json({ error: "Not authenticated" }, { status: 401 });
    }

    const dbUser = await prisma.user.findUnique({
      where: { discordId },
    });

    const envAdmin = discordId === process.env.ADMIN_DISCORD_ID;

    return Response.json({
      discordId,
      envAdmin,
      ADMIN_DISCORD_ID: process.env.ADMIN_DISCORD_ID,
      match: discordId === process.env.ADMIN_DISCORD_ID,
      dbUser: {
        id: dbUser?.id,
        username: dbUser?.username,
        isAdmin: dbUser?.isAdmin,
      },
      session: {
        user: {
          isAdmin: (session?.user as any)?.isAdmin,
        },
      },
    });
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
