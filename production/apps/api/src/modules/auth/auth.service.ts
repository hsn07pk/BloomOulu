import { Injectable } from '@nestjs/common';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class AuthService {
  constructor(private readonly prisma: PrismaService) {}

  /** Issue a single-use magic-link token (15-min TTL). */
  async issueMagicLink(email: string): Promise<{ token: string; expiresAt: Date }> {
    const token = randomBytes(32).toString('base64url');
    const tokenHash = this.hashToken(token);
    const expiresAt = new Date(Date.now() + 15 * 60_000);
    await this.prisma.verificationToken.create({
      data: { identifier: email, token: tokenHash, expires: expiresAt },
    });
    return { token, expiresAt };
  }

  /**
   * Upsert a user authenticated via University of Oulu OIDC. Caller has
   * already verified the id_token signature + claims. We persist the
   * sub as `ouluUid` so subsequent OIDC sign-ins land on the same row.
   */
  async upsertByOidc(input: { email: string; ouluUid: string; name: string | null; role: string }) {
    const allowedRoles = new Set(['donor', 'curator', 'finance', 'admin']);
    const role = (allowedRoles.has(input.role) ? input.role : 'donor') as
      | 'donor'
      | 'curator'
      | 'finance'
      | 'admin';
    return this.prisma.user.upsert({
      where: { email: input.email },
      update: {
        ouluUid: input.ouluUid,
        name: input.name ?? undefined,
        emailVerified: new Date(),
        role,
      },
      create: {
        email: input.email,
        ouluUid: input.ouluUid,
        name: input.name,
        emailVerified: new Date(),
        role,
      },
    });
  }

  async verifyMagicLink(email: string, token: string) {
    const tokenHash = this.hashToken(token);
    const row = await this.prisma.verificationToken.findUnique({
      where: { identifier_token: { identifier: email, token: tokenHash } },
    });
    if (!row || row.expires < new Date()) return null;
    await this.prisma.verificationToken.delete({
      where: { identifier_token: { identifier: email, token: tokenHash } },
    });
    return await this.prisma.user.upsert({
      where: { email },
      update: { emailVerified: new Date() },
      create: { email, emailVerified: new Date() },
    });
  }

  /** Look up whether an email already has a registered account. Used
   *  by the sign-in form to decide between asking for a password vs
   *  starting the verify-and-setup flow. */
  async lookup(email: string): Promise<{
    exists: boolean;
    hasPassword: boolean;
    verified: boolean;
  }> {
    const u = await this.prisma.user.findUnique({
      where: { email },
      select: { passwordHash: true, emailVerified: true },
    });
    return {
      exists: Boolean(u),
      hasPassword: Boolean(u?.passwordHash),
      verified: Boolean(u?.emailVerified),
    };
  }

  /** Sign in with email + password. Returns the user row on success
   *  or null on failure. Bcrypt comparison is constant-time. */
  async signInWithPassword(email: string, password: string) {
    if (!email || !password) return null;
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user?.passwordHash) return null;
    const ok = await bcrypt.compare(password, user.passwordHash);
    return ok ? user : null;
  }

  /** Consume a verify token AND set/replace the password. Used by the
   *  forgot-password flow: an existing donor requests a reset, clicks
   *  the link, lands on /auth/reset, submits a new password. The token
   *  is single-use; once consumed the link is dead. */
  async resetPassword(input: { email: string; token: string; password: string }) {
    if (!input.password || input.password.length < 8) {
      return { ok: false as const, reason: 'password_too_short' as const };
    }
    const tokenHash = this.hashToken(input.token);
    const row = await this.prisma.verificationToken.findUnique({
      where: { identifier_token: { identifier: input.email, token: tokenHash } },
    });
    if (!row || row.expires < new Date()) {
      return { ok: false as const, reason: 'invalid_or_expired' as const };
    }
    await this.prisma.verificationToken.delete({
      where: { identifier_token: { identifier: input.email, token: tokenHash } },
    });
    const passwordHash = await bcrypt.hash(input.password, 12);
    const user = await this.prisma.user.update({
      where: { email: input.email },
      data: { passwordHash, emailVerified: new Date() },
    });
    return { ok: true as const, user };
  }

  /** Consume a verify token AND set the password + name in one step.
   *  Used by the sign-up verify-and-setup endpoint, where the user
   *  clicks the verify link and is presented with a form to finish
   *  account creation. */
  async verifyAndSetup(input: {
    email: string;
    token: string;
    password: string;
    name?: string;
  }) {
    if (!input.password || input.password.length < 8) {
      return { ok: false as const, reason: 'password_too_short' as const };
    }
    const tokenHash = this.hashToken(input.token);
    const row = await this.prisma.verificationToken.findUnique({
      where: { identifier_token: { identifier: input.email, token: tokenHash } },
    });
    if (!row || row.expires < new Date()) {
      return { ok: false as const, reason: 'invalid_or_expired' as const };
    }
    await this.prisma.verificationToken.delete({
      where: { identifier_token: { identifier: input.email, token: tokenHash } },
    });
    const passwordHash = await bcrypt.hash(input.password, 12);
    const user = await this.prisma.user.upsert({
      where: { email: input.email },
      update: {
        emailVerified: new Date(),
        passwordHash,
        ...(input.name ? { name: input.name } : {}),
      },
      create: {
        email: input.email,
        emailVerified: new Date(),
        passwordHash,
        name: input.name ?? null,
      },
    });
    return { ok: true as const, user };
  }

  private hashToken(t: string): string {
    return createHmac('sha256', process.env.AUTH_SECRET ?? 'dev-secret')
      .update(t)
      .digest('hex');
  }

  static constantTimeEqual(a: string, b: string): boolean {
    const aBuf = Buffer.from(a);
    const bBuf = Buffer.from(b);
    if (aBuf.length !== bBuf.length) return false;
    return timingSafeEqual(aBuf, bBuf);
  }
}
