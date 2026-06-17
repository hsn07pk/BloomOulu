import { Controller, Get, Global, Module } from '@nestjs/common';
import { SettingsService } from './settings.service.js';

/**
 * Public, donor-safe subset of SystemSetting. Never exposes secrets
 * (Paytrail/MobilePay credentials, SMTP passwords, etc.) — only the values
 * the web app needs to render the donation flow.
 */
@Controller('settings')
class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get('public')
  publicSettings() {
    const s = this.settings.get();
    return {
      bankTransfer: {
        iban: s.bankTransfer.iban,
        bic: s.bankTransfer.bic,
        beneficiaryName: s.bankTransfer.beneficiaryName,
      },
      garden: s.garden,
      payments: s.payments,
      features: s.features,
      donation: s.donation,
      ask: s.ask,
      vat: s.vat,
      qrLabel: s.qrLabel,
      enrichment: s.enrichment,
      /**
       * Donor-safe test-mode hints. We never leak secrets; we only flag
       * which providers are pointing at sandbox endpoints so the
       * checkout UI can show test-card help text. A storefront on real
       * production credentials returns `testMode.paytrail === false`
       * etc. and the UI hides the banner.
       */
      testMode: {
        paytrail:
          process.env.PAYTRAIL_MERCHANT_ID === '375917' ||
          process.env.PAYTRAIL_MOCK === 'true',
        mobilepay: (process.env.MOBILEPAY_API_URL ?? '').includes('apitest.vipps.no'),
      },
    };
  }
}

@Global()
@Module({
  controllers: [SettingsController],
  providers: [SettingsService],
  exports: [SettingsService],
})
export class SettingsModule {}
