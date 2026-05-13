/**
 * Auth.js v5 (NextAuth beta) configured for:
 *   - Email magic-link via the API's /auth/magic-link endpoint
 *   - University of Oulu OIDC for staff / curator / finance roles
 *
 * Prisma adapter ties sessions to the Postgres schema (Account / Session
 * tables live in packages/db).
 */
import NextAuth from 'next-auth';
import EmailProvider from 'next-auth/providers/email';
import Credentials from 'next-auth/providers/credentials';
import { PrismaAdapter } from '@auth/prisma-adapter';
import { prisma } from '@bloomoulu/db';

export const { auth, handlers, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  session: { strategy: 'database' },
  providers: [
    Credentials({
      // Accepts a one-time token from the API's /auth/magic-link route.
      credentials: { email: { label: 'Email' }, token: { label: 'Token' } },
      authorize: async (creds) => {
        if (!creds?.email || !creds?.token) return null;
        // Hand off to API for verification → returns user row
        const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
        const res = await fetch(`${apiUrl}/v1/auth/verify-magic-link`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ email: creds.email, token: creds.token }),
        });
        if (!res.ok) return null;
        const user = await res.json();
        return user;
      },
    }),
    EmailProvider({
      server: process.env.SMTP_HOST ? {
        host: process.env.SMTP_HOST,
        port: parseInt(process.env.SMTP_PORT ?? '25', 10),
        auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
      } : undefined,
      from: process.env.EMAIL_FROM,
    }),
  ],
  pages: { signIn: '/sign-in' },
  trustHost: true,
});
