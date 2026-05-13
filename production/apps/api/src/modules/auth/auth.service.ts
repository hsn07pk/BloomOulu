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
