/**
 * NextAuth configuration + role guard helpers.
 *
 * For MVP we use Credentials provider (email + bcrypt password). JWT session
 * strategy avoids a DB hit on every API call.
 *
 * `requireSession()` / `requireRole()` are the only auth gates routes should use.
 */
import NextAuth, { type NextAuthOptions, type Session } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { compare } from "bcryptjs";
import type { UserRole } from "@prisma/client";
import { prisma } from "@/lib/db";
import { errors } from "@/lib/http";
import { getServerSession } from "next-auth/next";

type SessionUser = {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
};

declare module "next-auth" {
  interface Session {
    user: SessionUser;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    uid: string;
    role: UserRole;
    fullName: string;
  }
}

export const authOptions: NextAuthOptions = {
  session: { strategy: "jwt", maxAge: 60 * 60 * 8 }, // 8h shift
  providers: [
    CredentialsProvider({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;
        const user = await prisma.user.findUnique({
          where: { email: credentials.email.toLowerCase() },
        });
        if (!user || user.status !== "ACTIVE" || user.deletedAt) return null;
        const okPw = await compare(credentials.password, user.passwordHash);
        if (!okPw) return null;

        await prisma.user.update({
          where: { id: user.id },
          data: { lastLoginAt: new Date() },
        });

        return {
          id: user.id,
          email: user.email,
          fullName: user.fullName,
          role: user.role,
        } as unknown as SessionUser & { name?: string };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        // user shape comes from authorize()
        const u = user as unknown as SessionUser;
        token.uid = u.id;
        token.role = u.role;
        token.fullName = u.fullName;
        token.email = u.email;
      }
      return token;
    },
    async session({ session, token }) {
      session.user = {
        id: token.uid,
        email: token.email as string,
        fullName: token.fullName,
        role: token.role,
      };
      return session;
    },
  },
  pages: {
    signIn: "/login",
  },
  secret: process.env.NEXTAUTH_SECRET,
};

export const nextAuthHandler = NextAuth(authOptions);

/** Returns the active session or throws an unauthorized AppError. */
export async function requireSession(): Promise<Session> {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw errors.unauthorized();
  return session;
}

/** Throws forbidden if the session role is not in the allowed list. */
export async function requireRole(allowed: UserRole[]): Promise<Session> {
  const session = await requireSession();
  if (!allowed.includes(session.user.role)) throw errors.forbidden();
  return session;
}
