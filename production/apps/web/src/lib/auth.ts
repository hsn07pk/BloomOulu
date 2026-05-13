/**
 * Auth.js v5 (NextAuth beta) configured for:
 *   - Email magic-link via the API's /auth/magic-link endpoint
 *   - University of Oulu OIDC for staff / curator / finance roles
 *
 * Prisma adapter ties sessions to the Postgres schema (Account / Session
 * tables live in packages/db).
 */
import NextAuth, { type NextAuthConfig } from 'next-auth';
import EmailProvider from 'next-auth/providers/email';
import Credentials from 'next-auth/providers/credentials';
import { PrismaAdapter } from '@auth/prisma-adapter';
import { prisma } from '@bloomoulu/db';

// Build the provider list at module load. EmailProvider is *only* added
// when SMTP_HOST is configured — Auth.js v5 throws synchronously on import
// otherwise ("Nodemailer requires a `server` configuration"), which breaks
// every page that imports `auth()` even if email sign-in isn't being used.
const providers: NextAuthConfig['providers'] = [
  Credentials({
    credentials: { email: { label: 'Email' }, token: { label: 'Token' } },
    authorize: async (creds) => {
      if (!creds?.email || !creds?.token) return null;
      const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
      const res = await fetch(`${apiUrl}/v1/auth/verify-magic-link`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: creds.email, token: creds.token }),
      });
      if (!res.ok) return null;
      return res.json();
    },
  }),
];

if (process.env.SMTP_HOST) {
  providers.push(
    EmailProvider({
      server: {
        host: process.env.SMTP_HOST,
        port: parseInt(process.env.SMTP_PORT ?? '25', 10),
        auth: process.env.SMTP_USER
          ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
          : undefined,
      },
      from: process.env.EMAIL_FROM ?? 'no-reply@bloomoulu.fi',
    }),
  );
}

export const { auth, handlers, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  session: { strategy: 'database' },
  providers,
  pages: { signIn: '/sign-in' },
  trustHost: true,
});
