import { Injectable } from '@nestjs/common';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
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
