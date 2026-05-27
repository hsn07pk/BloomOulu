# Paytrail — test credentials

Paytrail uses **one endpoint for both test and production**:
`https://services.paytrail.com`. The test merchant is recognised by
its credentials. Set them in `.env` (or `.env.test-payments` if using
the test-payments overlay) and Paytrail's real hosted checkout shows
up — same UI, same callbacks, same signatures, no money moves.

## Merchant credentials

```
PAYTRAIL_MERCHANT_ID=375917
PAYTRAIL_SECRET=SAIPPUAKAUPPIAS
PAYTRAIL_WEBHOOK_SECRET=SAIPPUAKAUPPIAS
PAYTRAIL_API_URL=https://services.paytrail.com
PAYTRAIL_MOCK=false                              # switch off local mock
```

These are Paytrail's public test merchant — every integrator uses
them.

## Test cards

Source: [paytrail/api-documentation](https://github.com/paytrail/api-documentation/blob/main/docs/payment-method-providers.md)

| Card number              | Expiry  | CVC | Result                                                  |
|--------------------------|---------|-----|---------------------------------------------------------|
| `4153 0139 9970 0321`    | 11/2026 | 321 | **Happy path — 3DS auto-completes**                     |
| `4153 0139 9970 0313`    | 11/2026 | 313 | 3DS success (password `secret`)                         |
| `4153 0139 9970 0339`    | 11/2026 | 339 | 3DS attempted (some banks)                              |
| `4153 0139 9970 0347`    | 11/2026 | 347 | 3DS fails (merchant decides)                            |
| `4153 0139 9970 0354`    | 11/2026 | 354 | 3DS OK but insufficient funds (declined)                |
| `4153 0139 9970 1162`    | 11/2026 | 162 | Saved-card CIT soft decline (password `secret`)         |
| `4153 0139 9970 1170`    | 11/2026 | 170 | Saved-card CIT soft decline (auto)                      |
| `4153 0139 9970 0024`    | 11/2026 | 024 | Non-EU "one leg out", not 3DS-enrolled                  |
| `4153 0139 9970 0156`    | 11/2026 | 156 | Non-EU, insufficient funds                              |
| `3739 5319 2351 004`     | 12/2026 | 1004| American Express                                        |

3DS form password where required: **`secret`**.

## Test bank logins (online banking buttons)

| Bank                          | `checkout-provider` | Credentials                                                   |
|-------------------------------|---------------------|---------------------------------------------------------------|
| Nordea                        | `nordea`            | (none needed)                                                 |
| OP / Osuuspankki              | `osuuspankki`       | (none needed, no UI shown)                                    |
| POP / Säästöpankki / OmaSP    | `pop` / `saastopankki` / `omasp` | user `11111111`, pw `123456`, key `123456`        |
| Aktia                         | `aktia`             | user `12345678`, pw `123456`, key `1234`                      |
| S-Pankki                      | `spankki`           | user `12345678`, pw `9999`, key `1234`                        |
| Siirto                        | `siirto`            | success: `+358401122332` · decline: `+358401122333`           |
| Walley / Walley B2B           | `walleyb2c` / `walleyb2b` | SSN `010380-000P`                                       |
| Danske                        | `danske`            | **requires real Danske credentials** (no test creds)          |
| Klarna                        | `klarna`            | Sample data: <https://docs.klarna.com/resources/developer-tools/sample-data/sample-customer-data/#europe-finland> |
| MobilePay through Paytrail    | `mobilepay`         | Email `tekniikka@paytrail.com` for the separate MobilePay test app |
| Apple Pay / Google Pay        | various             | Real Apple Pay / Google account required                      |
| Ålandsbanken, Nordea B2B, Danske B2B, OP Lasku, PayPal | various | Not testable in sandbox                       |

## Limits and quirks

- Minimum test payment: **€0.65** (Paytrail rejects smaller test amounts).
- Refund APIs not implemented for S-Pankki, Ålandsbanken (email-only refunds).
- In the test environment, refunds don't work for Nordea, Aktia, or PayPal.

## How to test end-to-end

1. Start the test stack: `bash scripts/payment-test-up.sh`
2. Open the printed web tunnel URL → `/en/plants`
3. Pick a plant → Adopt → choose Card
4. Paytrail's real hosted checkout opens on `pay.paytrail.com`
5. Use `4153 0139 9970 0321` (exp `11/26`, CVC `321`) for the happy path
6. Verify in the admin panel that the adoption activated and a receipt
   was issued

The same code path that handles real money handles this. The only
difference is which credentials sit in `.env`.
