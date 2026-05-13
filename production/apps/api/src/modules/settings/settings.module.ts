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
      payments: s.payments,
      features: s.features,
      defaultAmountCents: s.defaultAmountCents,
      adoptionFlow: s.adoptionFlow,
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
