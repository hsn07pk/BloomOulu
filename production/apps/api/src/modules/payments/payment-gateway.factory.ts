import { Injectable, Logger } from '@nestjs/common';
import {
  BankTransferGateway,
  MobilePayGateway,
  PaytrailGateway,
  type PaymentGateway,
  type ProviderId,
} from '@bloomoulu/payments';
import { SettingsService } from '../settings/settings.service.js';

/**
 * Resolve a PaymentGateway by id, with config loaded from settings + env.
 *
 * Adapters are stateless and cheap; we re-instantiate per call so settings
 * changes (admin flips a key) take effect within ~60s.
 */
@Injectable()
export class PaymentGatewayFactory {
  private readonly logger = new Logger(PaymentGatewayFactory.name);

  constructor(private readonly settings: SettingsService) {}

  for(provider: ProviderId): PaymentGateway {
    switch (provider) {
      case 'bank_transfer':
        return this.bankTransfer();
      case 'paytrail':
        return this.paytrail();
      case 'mobilepay':
        return this.mobilepay();
      default:
        throw new Error(`Unknown payment provider: ${provider}`);
    }
  }

  enabledProviders(): ProviderId[] {
    const s = this.settings.get().payments;
    const out: ProviderId[] = [];
    if (s.bank_transfer) out.push('bank_transfer');
    if (s.paytrail) out.push('paytrail');
    if (s.mobilepay) out.push('mobilepay');
    return out;
  }

  private bankTransfer(): BankTransferGateway {
    const cfg = this.settings.get().bankTransfer;
    return new BankTransferGateway(cfg);
  }

  private paytrail(): PaytrailGateway {
    const merchantId = process.env.PAYTRAIL_MERCHANT_ID;
    const secret = process.env.PAYTRAIL_SECRET;
    if (!merchantId || !secret) {
      throw new Error('Paytrail enabled but PAYTRAIL_MERCHANT_ID / PAYTRAIL_SECRET not set');
    }
    return new PaytrailGateway({
      merchantId,
      secret,
      apiBaseUrl: process.env.PAYTRAIL_API_URL,
      webhookSecret: process.env.PAYTRAIL_WEBHOOK_SECRET,
    });
  }

  private mobilepay(): MobilePayGateway {
    return new MobilePayGateway({
      clientId: process.env.MOBILEPAY_CLIENT_ID ?? '',
      clientSecret: process.env.MOBILEPAY_CLIENT_SECRET ?? '',
      subscriptionKey: process.env.MOBILEPAY_SUBSCRIPTION_KEY ?? '',
      merchantSerialNumber: process.env.MOBILEPAY_MERCHANT_SERIAL_NUMBER ?? '',
      webhookSecret: process.env.MOBILEPAY_WEBHOOK_SECRET ?? '',
      apiBaseUrl: process.env.MOBILEPAY_API_URL,
      returnUrl: process.env.MOBILEPAY_RETURN_URL ?? '',
      callbackPrefix: process.env.MOBILEPAY_CALLBACK_URL ?? '',
    });
  }
}
