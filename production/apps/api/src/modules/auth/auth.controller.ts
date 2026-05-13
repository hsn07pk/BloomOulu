import { Body, Controller, Get, Post, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ZodValidationPipe } from '../../common/zod.pipe.js';
import { AuthService } from './auth.service.js';

const EmailBody = z.object({ email: z.string().email() });

@Controller('auth')
export class AuthController {
  constructor(private readonly svc: AuthService) {}

  @Post('magic-link')
  async magicLink(@Body(new ZodValidationPipe(EmailBody)) body: { email: string }) {
    const link = await this.svc.issueMagicLink(body.email);
    // The actual email is sent by the worker via the Email queue. Returning
    // success here without revealing whether the address exists, per OWASP.
    return { ok: true, expiresAt: link.expiresAt };
  }

  @Get('session')
  async session(@Req() req: FastifyRequest) {
    // Session cookie set by web (Auth.js). The API does a JWT verify here in
    // production; minimal stub for now.
    const session = (req as any).cookies?.['authjs.session-token'] ?? null;
    return { authenticated: Boolean(session) };
  }
}
