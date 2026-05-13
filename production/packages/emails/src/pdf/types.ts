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
}

export interface OrgInfo {
  name: string;
  vatId: string;
  iban: string;
  address: string;
  email: string;
  signatureUrl?: string;
}
