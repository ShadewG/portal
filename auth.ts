import NextAuth from "next-auth";
import Discord from "next-auth/providers/discord";

export const { handlers, signIn, signOut, auth } = NextAuth({
  // Discord now adds the RFC 9207 "iss" parameter to its OAuth callback. With no issuer set,
  // Auth.js checks it against its "https://authjs.dev" placeholder and fails the sign-in
  // ("unexpected iss", 11-12 Oct 2026). https://discord.com is Discord's published issuer.
  providers: [Discord({ issuer: "https://discord.com" })],
  session: {
    strategy: "jwt",
    maxAge: 365 * 24 * 60 * 60,
    updateAge: 7 * 24 * 60 * 60,
  },
  trustHost: true,
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
        // Discord's own "email is verified" flag (R-2159 risk 9: pre-grants by email need it, lib/pendingAccess.ts)
        token.emailVerified = (profile as Record<string, unknown>).verified === true;
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
        u.emailVerified = token.emailVerified === true;
      }
      return session;
    },
  },
  pages: {
    signIn: "/login",
  },
});
