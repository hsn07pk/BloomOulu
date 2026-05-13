/**
 * Manual bank transfer adapter — the zero-fee default rail.
 *
 * Flow:
 *   1. Donor confirms adoption on web.
 *   2. We generate a unique ISO 11649 RF Creditor Reference for the order.
 *   3. Web shows the Garden's IBAN + reference + amount on a printable page,
 *      with a "Pay in your banking app" link that prefaces an SCT payment
 *      with the RF reference pre-filled (works on Nordea/OP/S-Pankki apps via
 *      the `payto://` URI scheme on iOS or `nordea://` etc.; for desktop, the
 *      donor copies the reference).
 *   4. Donor pays from their bank to the Garden's account, including the RF
 *      reference exactly as shown.
 *   5. Once per day (or whenever the Garden's accountant uploads a fresh
 *      bank CSV), the API's reconciliation job parses the file, matches RF
 *      references to `Payment.orderId`, and marks payments succeeded.
 *
 * No fees are charged by any third party. Reconciliation runs server-side.
 *
 * Refunds: the staff issues a manual SCT reversal; admin marks Payment as
 * refunded; the system credits the receipt and triggers the credit-note PDF.
 */

import { randomUUID } from 'node:crypto';
import { PaymentGatewayError } from '../types.js';
import type {
  PaymentGateway,
  CreateCheckoutInput,
  CheckoutHandoff,
  CreateAgreementInput,
  AgreementHandoff,
  ChargeAgreementInput,
  ChargeResult,
  CancelAgreementInput,
  RefundInput,
  RefundResult,
  ParseWebhookInput,
  NormalisedEvent,
} from '../types.js';

export interface BankTransferConfig {
  /** Garden's IBAN, e.g. "FI21 1234 5600 0007 85". */
  iban: string;
  /** BIC, e.g. "NDEAFIHH". */
  bic: string;
  /** Beneficiary legal name (shows up in donor's bank app). */
  beneficiaryName: string;
  /** Public URL where the donor sees the payment instructions page. */
  instructionsUrl: string;
}

/**
 * Generate an ISO 11649 RF Creditor Reference for an order.
 * Algorithm:
 *   1. Take alphanumeric reference body (here: stripped UUIDv7 = 32 hex
 *      characters, then uppercased — already ISO-11649 conformant).
 *   2. Append "RF00" → "<body>RF00".
 *   3. Convert each letter A=10, B=11, ..., Z=35.
 *   4. The resulting big integer mod 97.
 *   5. Check digits = 98 - (mod result), zero-padded to 2.
 *   6. Final reference = "RF" + checkDigits + body.
 *
 * We additionally insert non-significant spaces every 4 chars when displayed,
 * per finanssiala recommendation.
 *
 * Returns a string like "RF18 1234 5678 9ABC DEF0 1234 5678 9".
 */
export function rfCreditorReference(orderId: string): string {
  // Body: strip dashes, uppercase, take first 21 alphanumerics.
  const body = orderId.replace(/-/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 21);
  const numeric = (body + 'RF00')
    .split('')
    .map((c) => {
      const code = c.charCodeAt(0);
      if (code >= 48 && code <= 57) return c; // 0-9
      if (code >= 65 && code <= 90) return String(code - 55); // A=10..Z=35
      return '';
    })
    .join('');
  // mod 97 over the big number, computed digit-by-digit to avoid BigInt cost.
  let remainder = 0;
  for (const ch of numeric) {
    remainder = (remainder * 10 + parseInt(ch, 10)) % 97;
  }
  const check = 98 - remainder;
  const checkStr = check.toString().padStart(2, '0');
  const ref = `RF${checkStr}${body}`;
  // Group with spaces every 4 chars.
  return ref.replace(/(.{4})/g, '$1 ').trim();
}

/** Verify a candidate RF reference (incoming from a bank CSV). */
export function isValidRfReference(ref: string): boolean {
  const clean = ref.replace(/\s+/g, '').toUpperCase();
  if (!/^RF[0-9]{2}[A-Z0-9]{1,21}$/.test(clean)) return false;
  const reordered = clean.slice(4) + clean.slice(0, 4);
  const numeric = reordered
    .split('')
    .map((c) => {
      const code = c.charCodeAt(0);
      if (code >= 48 && code <= 57) return c;
      if (code >= 65 && code <= 90) return String(code - 55);
      return '';
    })
    .join('');
  let remainder = 0;
  for (const ch of numeric) {
    remainder = (remainder * 10 + parseInt(ch, 10)) % 97;
  }
  return remainder === 1;
}

export class BankTransferGateway implements PaymentGateway {
  readonly id = 'bank_transfer' as const;

  constructor(private readonly cfg: BankTransferConfig) {
    if (!cfg.iban || !cfg.bic || !cfg.beneficiaryName || !cfg.instructionsUrl) {
      throw new Error('BankTransferGateway: incomplete configuration');
    }
  }

  /**
   * Returns the URL of our own instructions page; we redirect the donor there
   * with the orderId, and the page shows: amount, IBAN, BIC, RF reference,
   * and a QR-code-based deeplink for mobile banking apps.
   */
  async createCheckout(input: CreateCheckoutInput): Promise<CheckoutHandoff> {
    const url = new URL(this.cfg.instructionsUrl);
    url.searchParams.set('orderId', input.orderId);
    url.searchParams.set(
      'amount',
      input.lineItems.reduce((s, li) => s + li.amountCents, 0).toString(),
    );
    url.searchParams.set('ref', rfCreditorReference(input.orderId));
    url.searchParams.set('locale', input.donor.locale);
    return {
      provider: this.id as any,
      redirectUrl: url.toString(),
      providerSessionId: input.orderId,
    };
  }

  /** Recurring bank transfers are not supported — the donor must initiate
   *  each payment from their bank. We can email reminders instead. */
  async createAgreement(_: CreateAgreementInput): Promise<AgreementHandoff> {
    throw new PaymentGatewayError(
      this.id as any,
      'bank_transfer.recurring.unsupported',
      'Bank-transfer adoptions are reminder-based: donor receives an email per period with fresh RF reference.',
      false,
    );
  }
  async chargeAgreement(_: ChargeAgreementInput): Promise<ChargeResult> {
    return {
      ok: false,
      code: 'bank_transfer.unsupported',
      message: 'Bank transfer recurring is reminder-driven',
    };
  }
  async cancelAgreement(_: CancelAgreementInput): Promise<void> {
    return;
  }

  /** Refund is a staff-initiated outgoing SEPA Credit Transfer. We record it
   *  as a Payment row of type=refund; no actual API call here. */
  async refund(input: RefundInput): Promise<RefundResult> {
    return {
      ok: true,
      refundId: 'manual-' + randomUUID(),
    };
  }

  /**
   * "Webhook" is the daily reconciliation. Bank CSV uploads land here. The
   * caller passes rawBody = a single CSV row (Tilisiirto/camt.054 reduced).
   * The body shape we expect:
   *   { reference, amountCents, paidAt, debtorName }
   */
  async parseWebhook(input: ParseWebhookInput): Promise<NormalisedEvent> {
    const payload = JSON.parse(input.rawBody) as {
      reference: string;
      amountCents: number;
      paidAt: string;
      debtorName?: string;
      bankRef?: string;
    };
    if (!isValidRfReference(payload.reference)) {
      return {
        kind: 'unknown',
        provider: this.id as any,
        providerEventId: payload.bankRef ?? payload.reference,
        raw: payload,
      };
    }
    // The orderId is encoded in the RF body (uppercase, no dashes). The
    // reconciliation service is responsible for mapping it back to the
    // canonical UUIDv7 form.
    return {
      kind: 'checkout.completed',
      provider: this.id as any,
      providerEventId: payload.bankRef ?? payload.reference,
      orderId: extractOrderIdFromRf(payload.reference),
      providerPaymentRef: payload.bankRef ?? payload.reference,
      providerSessionId: payload.bankRef ?? payload.reference,
      amountCents: payload.amountCents,
      currency: 'EUR',
      paidAt: new Date(payload.paidAt),
      metadata: { debtorName: payload.debtorName ?? '' },
    };
  }
}

/**
 * Recover the UUIDv7 orderId from the RF reference body. Since we generated
 * the body by stripping dashes + uppercasing + truncating to 21 alphanumerics,
 * we cannot perfectly reverse it. Instead, the reconciliation job looks up
 * the most recent pending Payment whose `orderId.replace('-','').toUpperCase()`
 * starts with the RF body. This is exact for our flow.
 */
function extractOrderIdFromRf(ref: string): string {
  return ref.replace(/\s+/g, '').slice(4); // strip "RF" + 2 check digits
}
