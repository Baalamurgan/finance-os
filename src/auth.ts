import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { prisma } from "@/lib/prisma";

// Google login, restricted to family Gmail addresses whitelisted on Member.email.
// JWT sessions (no DB adapter); role/memberId are looked up at sign-in.
export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  session: { strategy: "jwt" },
  providers: [Google],
  pages: { signIn: "/signin" },
  callbacks: {
    // whitelist: only emails that map to a Member may sign in
    async signIn({ user }) {
      const email = user.email?.toLowerCase();
      if (!email) return false;
      const member = await prisma.member.findFirst({ where: { email } });
      return !!member;
    },
    async jwt({ token, user }) {
      // Re-resolve member identity by email on every call (not just sign-in) so a
      // DB reseed — which changes autoincrement member ids — never leaves a stale
      // memberId in the token (which would FK-violate on spend/expense writes).
      const email = (user?.email ?? token.email)?.toLowerCase();
      if (email) {
        const member = await prisma.member.findFirst({ where: { email } });
        if (member) {
          token.memberId = member.id;
          token.role = member.role;
          token.memberName = member.name;
          // keep token.name as the Google account name (for the avatar/menu)
        }
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.memberId = token.memberId as number | undefined;
        session.user.role = (token.role as string) ?? "member";
        session.user.memberName = token.memberName as string | undefined;
        // session.user.name stays the Google name; session.user.image is the avatar
      }
      return session;
    },
  },
});
