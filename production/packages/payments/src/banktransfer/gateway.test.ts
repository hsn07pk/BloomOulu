import { describe, it, expect } from 'vitest';
import { rfCreditorReference, isValidRfReference } from './gateway.js';

describe('RF Creditor Reference (ISO 11649)', () => {
  it('generates a valid reference for a UUIDv7 orderId', () => {
    const orderId = '0190a3b1-c842-7d8f-9abc-def012345678';
    const ref = rfCreditorReference(orderId);
    expect(ref).toMatch(/^RF\d{2}/);
    expect(isValidRfReference(ref)).toBe(true);
  });

  it('rejects tampered references', () => {
    const ref = rfCreditorReference('0190a3b1-c842-7d8f-9abc-def012345678');
    const tampered = ref.replace('A', 'B').replace('1', '2');
    expect(isValidRfReference(tampered)).toBe(false);
  });

  it('round-trips known fixture from finanssiala', () => {
    // From https://www.finanssiala.fi guidance examples:
    expect(isValidRfReference('RF18 5390 0754 7034')).toBe(true);
    expect(isValidRfReference('RF18539007547034')).toBe(true);
  });

  it('is deterministic for a given orderId', () => {
    const a = rfCreditorReference('019085b0-1111-7000-8000-aaaaaaaaaaaa');
    const b = rfCreditorReference('019085b0-1111-7000-8000-aaaaaaaaaaaa');
    expect(a).toBe(b);
  });
});
