export interface ReceiptPdfInput {
  number: string;
  locale: 'en' | 'fi' | 'sv';
  donorName: string;
  donorAddress?: {
    line1?: string;
    line2?: string;
    postalCode?: string;
    city?: string;
    country?: string;
  } | null;
  amountCents: number;
  currency: string;
  vatRateBp: number;
  vatCents: number;
  netCents: number;
  paidAt: Date;
  plantName?: string | null;
  tierName?: string | null;
  orderId: string;

  // ── Personalisation (set when the Payment is linked to an Adoption) ──
  // Each of these is optional — the renderer only shows a block when
  // there's content. Keeps single-line donations clean while letting
  // gift / memorial / class / corporate receipts carry the full context
  // a donor expects to see on the official document.
  intent?: 'for_self' | 'gift' | 'memorial' | 'class' | 'corporate';
  billingInterval?: 'one_time' | 'monthly' | 'annual';
  recurring?: boolean;
  nickname?: string | null;
  dedication?: string | null;
  homeRegion?: string | null;
  giftRecipientName?: string | null;
  giftRecipientEmail?: string | null;
  memorialOf?: string | null;
  coAdopters?: Array<{ name?: string | null; email?: string | null }> | null;
}

export interface OrgInfo {
  name: string;
  vatId: string;
  iban: string;
  address: string;
  email: string;
  signatureUrl?: string;
}

export interface TaxCertificatePdfInput {
  certificateNumber: string;
  locale: 'en' | 'fi' | 'sv';
  donorName: string;
  donorAddress?: {
    line1?: string;
    line2?: string;
    postalCode?: string;
    city?: string;
    country?: string;
  } | null;
  /**
   * TVL §57 corporate scheme (≥ €850 donation to a Finnish university for
   * scientific/artistic purposes; deduction capped at €250,000/year), or the
   * 2026 individual donor scheme placeholder, or "informational".
   */
  scheme: 'TVL §57 corporate' | 'individual 2026' | 'informational';
  taxYear: number;
  totalCents: number;
  currency: string;
  receiptNumbers: string[];
  issuedAt: Date;
}

