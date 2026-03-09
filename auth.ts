import NextAuth from "next-auth";
import Discord from "next-auth/providers/discord";

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [Discord],
  callbacks: {
    authorized({ auth: session }) {
      return !!session?.user;
    },
    jwt({ token, profile }) {
      if (profile) {
        token.discordId = profile.id;
        token.avatar = profile.avatar;
        token.username = (profile as Record<string, unknown>).username;
        token.globalName = (profile as Record<string, unknown>).global_name;
        token.isAdmin = profile.id === process.env.ADMIN_DISCORD_ID;
        // Flag for post-login upsert
        token.needsSync = true;
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
