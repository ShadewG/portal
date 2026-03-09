import NextAuth from "next-auth";
import Discord from "next-auth/providers/discord";
import { prisma } from "@/lib/db";

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [Discord],
  callbacks: {
    authorized({ auth: session }) {
      return !!session?.user;
    },
    async jwt({ token, profile }) {
      if (profile) {
        token.discordId = profile.id;
        token.avatar = profile.avatar;
        token.username = (profile as Record<string, unknown>).username;
        token.globalName = (profile as Record<string, unknown>).global_name;

        // Upsert user on login
        const discordId = profile.id as string;
        const username = ((profile as Record<string, unknown>).username as string) ?? "unknown";
        const avatar = (profile.avatar as string) ?? null;
        const email = (profile.email as string) ?? null;
        const isAdmin = discordId === process.env.ADMIN_DISCORD_ID;

        try {
          await prisma.user.upsert({
            where: { discordId },
            update: { username, avatar, email },
            create: { discordId, username, avatar, email, isAdmin },
          });
        } catch {
          // DB may not be ready yet — don't block login
        }

        token.isAdmin = isAdmin;
      }
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        const u = session.user as unknown as Record<string, unknown>;
        u.discordId = token.discordId;
        u.avatar = token.avatar;
        u.username = token.username;
        u.globalName = token.globalName;
        u.isAdmin = token.isAdmin;
      }
      return session;
    },
  },
  pages: {
    signIn: "/login",
  },
});
