import { Body, Controller, Get, Logger, Post, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ZodValidationPipe } from '../../common/zod.pipe.js';
import { AuthService } from './auth.service.js';
import { sendEmail } from '../../infra/email.js';

const EmailBody = z.object({ email: z.string().email(), locale: z.enum(['en', 'fi', 'sv']).optional() });
const VerifyBody = z.object({ email: z.string().email(), token: z.string().min(1) });
const LookupBody = z.object({ email: z.string().email() });
const SignInBody = z.object({ email: z.string().email(), password: z.string().min(1) });
const VerifyAndSetupBody = z.object({
  email: z.string().email(),
  token: z.string().min(1),
  password: z.string().min(8).max(200),
  name: z.string().min(1).max(120).optional(),
});

@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);
  constructor(private readonly svc: AuthService) {}

  @Post('magic-link')
  async magicLink(@Body(new ZodValidationPipe(EmailBody)) body: { email: string; locale?: 'en' | 'fi' | 'sv' }) {
    const link = await this.svc.issueMagicLink(body.email);
    const locale = body.locale ?? 'en';
    const webUrl = process.env.NEXT_PUBLIC_WEB_URL ?? 'http://localhost:3000';
    const verifyUrl = `${webUrl}/${locale}/auth/verify?email=${encodeURIComponent(body.email)}&token=${encodeURIComponent(link.token)}`;
    const subject =
      locale === 'fi'
        ? 'Kirjautumislinkkisi · BloomOulu'
        : locale === 'sv'
          ? 'Din inloggningslänk · BloomOulu'
          : 'Your BloomOulu sign-in link';
    const greeting =
      locale === 'fi'
        ? 'Tervetuloa takaisin'
        : locale === 'sv'
          ? 'Välkommen tillbaka'
          : 'Welcome back';
    const intro =
      locale === 'fi'
        ? 'Napsauta alla olevaa linkkiä kirjautuaksesi BloomOuluun. Linkki vanhenee 15 minuutissa.'
        : locale === 'sv'
          ? 'Klicka på länken nedan för att logga in på BloomOulu. Länken upphör att gälla om 15 minuter.'
          : 'Click the link below to sign in to BloomOulu. The link expires in 15 minutes.';
    const cta =
      locale === 'fi'
        ? 'Kirjaudu sisään'
        : locale === 'sv'
          ? 'Logga in'
          : 'Sign in';
    const footer =
      locale === 'fi'
        ? "Et tilannut tätä? Voit jättää viestin huomiotta — kukaan ei kirjaudu nimissäsi."
        : locale === 'sv'
          ? 'Inte du? Du kan ignorera detta meddelande — ingen kan logga in i ditt namn.'
          : "Didn't request this? You can safely ignore this — no one can sign in as you.";
    const html = `
      <!doctype html>
      <html><body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 560px; margin: 24px auto; padding: 24px; color: #1F3C2D;">
        <h1 style="font-family: Fraunces, Georgia, serif; font-size: 28px; font-weight: 400; margin: 0 0 8px;">${greeting}.</h1>
        <p style="font-size: 15px; line-height: 1.55; color: #2D5440;">${intro}</p>
        <p style="margin: 28px 0;">
          <a href="${verifyUrl}" style="display: inline-block; padding: 14px 28px; background: #2D5440; color: #FAF7EE; text-decoration: none; border-radius: 999px; font-weight: 500;">${cta} →</a>
        </p>
        <p style="font-size: 13px; color: #6B7560;">${footer}</p>
        <hr style="border: none; border-top: 1px solid #E5E2D8; margin: 32px 0;" />
        <p style="font-size: 12px; color: #88897C; margin: 0;">BloomOulu · University of Oulu Botanical Garden</p>
      </body></html>
    `;
    try {
      await sendEmail({ to: body.email, subject, html });
    } catch (err) {
      // Don't reveal the failure to the caller (OWASP user-enumeration guidance)
      // — but log it so the operator can diagnose SMTP/transport problems.
      this.logger.error(`magic-link email send failed for ${body.email}: ${(err as Error).message}`);
    }
    return { ok: true, expiresAt: link.expiresAt };
  }

  /**
   * Consume a magic-link token. On success, returns the verified user.
   * The web layer turns this into a session cookie via Auth.js. The
   * endpoint is idempotent: a stale token returns 200 with `null` so we
   * never reveal whether an email exists.
   */
  /**
   * OIDC upsert endpoint — called only by the web layer's callback route
   * after it has verified the Oulu id_token signature. Protected by a
   * shared secret header so the public can't call it directly.
   */
  @Post('oidc-upsert')
  async oidcUpsert(
    @Req() req: FastifyRequest,
    @Body()
    body: {
      email: string;
      ouluUid: string;
      name?: string | null;
      claims?: Record<string, unknown>;
    },
  ) {
    const expected = process.env.AUTH_SECRET ?? 'dev-secret';
    const provided = (req.headers['x-bloomoulu-oidc-secret'] as string | undefined) ?? '';
    if (!AuthService.constantTimeEqual(expected, provided)) {
      return { ok: false };
    }
    const groups = Array.isArray((body.claims as { groups?: unknown })?.groups)
      ? ((body.claims as { groups: unknown[] }).groups as string[])
      : [];
    const isCurator = groups.some((g) => /garden|botani|curator/i.test(g));
    const isAdmin = groups.some((g) => /admin/i.test(g));
    const role = isAdmin ? 'admin' : isCurator ? 'curator' : 'donor';
    const user = await this.svc.upsertByOidc({
      email: body.email,
      ouluUid: body.ouluUid,
      name: body.name ?? null,
      role,
    });
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      locale: user.locale,
    };
  }

  @Post('verify')
  async verify(@Body(new ZodValidationPipe(VerifyBody)) body: { email: string; token: string }) {
    const user = await this.svc.verifyMagicLink(body.email, body.token);
    if (!user) return { ok: false, user: null };
    return {
      ok: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.name ?? null,
        role: user.role,
        locale: user.locale,
      },
    };
  }

  /**
   * Look up whether an email is already registered so the sign-in form
   * can either ask for the password or send a verify-and-setup link.
   * Always returns ok:true and never reveals timing-sensitive info to
   * an attacker who is trying to enumerate accounts.
   */
  @Post('lookup')
  async lookup(@Body(new ZodValidationPipe(LookupBody)) body: { email: string }) {
    const info = await this.svc.lookup(body.email);
    return { ok: true, ...info };
  }

  /** Email + password sign-in. */
  @Post('sign-in')
  async signIn(@Body(new ZodValidationPipe(SignInBody)) body: { email: string; password: string }) {
    const user = await this.svc.signInWithPassword(body.email, body.password);
    if (!user) return { ok: false as const, user: null };
    return {
      ok: true as const,
      user: {
        id: user.id,
        email: user.email,
        name: user.name ?? null,
        role: user.role,
        locale: user.locale,
      },
    };
  }

  /** Verify a sign-up token AND set the password + name in one step.
   *  Used by /auth/verify on the web after the new user clicks the
   *  link in their welcome email. */
  @Post('verify-and-setup')
  async verifyAndSetup(
    @Body(new ZodValidationPipe(VerifyAndSetupBody))
    body: { email: string; token: string; password: string; name?: string },
  ) {
    const r = await this.svc.verifyAndSetup(body);
    if (!r.ok) return { ok: false as const, reason: r.reason };
    return {
      ok: true as const,
      user: {
        id: r.user.id,
        email: r.user.email,
        name: r.user.name ?? null,
        role: r.user.role,
        locale: r.user.locale,
      },
    };
  }

  @Get('session')
  async session(@Req() req: FastifyRequest) {
    // Session cookie set by web (Auth.js). The API does a JWT verify here in
    // production; minimal stub for now.
    const session = (req as any).cookies?.['authjs.session-token'] ?? null;
    return { authenticated: Boolean(session) };
  }
}
