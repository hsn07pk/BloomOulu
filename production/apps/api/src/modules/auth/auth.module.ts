/**
 * Auth module.
 *
 * Production auth lives on the WEB side (Auth.js v5) — the API trusts a
 * signed session cookie that the web sets after a Magic Link / OIDC sign-in.
 *
 * This module exposes:
 *   - /v1/auth/session: who is logged in (cookie verified)
 *   - /v1/auth/magic-link: send a magic link email (for kiosk-pairing / mobile)
 *
 * Implementation note: actual handler bodies are intentionally compact;
 * the security-critical paths (signing, verification) reuse the @auth/core
 * primitives via a small adapter to avoid duplication with the web app.
 */
import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';

@Module({
  controllers: [AuthController],
  providers: [AuthService],
  exports: [AuthService],
})
export class AuthModule {}
