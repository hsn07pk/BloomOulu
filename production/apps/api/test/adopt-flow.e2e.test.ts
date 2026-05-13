/**
 * End-to-end adoption flow — POST /v1/adoptions yields a Payment row with
 * provider=bank_transfer (the default) and returns a redirect to the bank
 * instructions page.
 *
 * Runs against a booted API container in CI.
 */
import { describe, it, expect } from 'vitest';

const API = process.env.API_URL ?? 'http://localhost:4000';

describe('POST /v1/adoptions (bank_transfer)', () => {
  it.skip('creates an Adoption + Payment + returns redirect URL', async () => {
    // Skipped by default; enable when the API container + seeded DB are up.
    const res = await fetch(`${API}/v1/adoptions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        plantSlug: 'pulsatilla-patens',
        tierId: 'seedling',
        billingInterval: 'annual',
        intent: 'for_self',
        recurring: false,
        donor: { email: 'test@example.com', locale: 'fi', countryCode: 'FI' },
        preferredProvider: 'bank_transfer',
      }),
    });
    expect(res.ok).toBe(true);
    const json = await res.json();
    expect(json.provider).toBe('bank_transfer');
    expect(json.redirectUrl).toMatch(/donate\/pay/);
  });
});
