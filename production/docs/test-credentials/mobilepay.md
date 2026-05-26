# Vipps MobilePay — test credentials

Unlike Paytrail, Vipps does **not** publish a shared public test
merchant. Each integrator gets their own free test sales unit from
the developer portal. The portal hands you four credentials, a test
user (phone + national-ID), and a pre-registered payment card — these
go into the test app on your phone and exercise the real Vipps
recurring + ePayment APIs at `https://apitest.vipps.no`.

## Registering for test credentials (one-time, ~15 minutes, free)

1. Go to <https://portal.vippsmobilepay.com>
2. Sign up with an email + phone number
3. Create an organisation. For "industry" pick e.g. *"Non-profit /
   Botanical garden"*
4. **Sales unit → Add new test sales unit**. Pick *MobilePay* (for
   FI/DK) or *Vipps* (for NO/SE)
5. **For developers → Order API** → tick *ePayment API* + *Recurring
   API* (free for test sales units)
6. **For developers → API credentials**. Copy four values:
   - `client_id`
   - `client_secret`
   - `Ocp-Apim-Subscription-Key`
   - `Merchant-Serial-Number` (MSN)

Paste them into `.env.test-payments`:

```
MOBILEPAY_CLIENT_ID=<from portal>
MOBILEPAY_CLIENT_SECRET=<from portal>
MOBILEPAY_SUBSCRIPTION_KEY=<from portal>
MOBILEPAY_MERCHANT_SERIAL_NUMBER=<from portal>
MOBILEPAY_API_URL=https://apitest.vipps.no
PAYMENTS_MOBILEPAY_ENABLED=true
```

## Creating a test user

In the portal: **For developers → Test users → Add new test user**.
You get back:

- A test **phone number** (format `+47 1234 5678`)
- A **National Identity Number** (NIN, 9-10 digits)
- A **pre-registered payment card** the test user can pay with

The phone number is unique to your sales unit — you can't use real
phone numbers or real Vipps user accounts in the test environment.

## Installing the test app on your phone

The production Vipps app **cannot** talk to `apitest.vipps.no`. You
need the dedicated *Vipps MobilePay MT* (Merchant Test) app.

- **iOS:** <https://testflight.apple.com/join/hTAYrwea> — no invite
  code required.
- **Android:** Join the Google Group
  `vipps-mobilepay-test-app` first, then install from
  <https://play.google.com/store/apps/details?id=no.dnb.vipps.mt>

After install:

1. Select country matching your sales unit
2. Enter the test user's National Identity Number
3. Enter the test user's phone number
4. PIN **`1236`** to confirm phone
5. PIN **`1236`** twice to set personal code

The MT app accepts up to 10,000 wrong PIN attempts before locking, so
you can't really mistype your way out of it.

## Registering the webhook (one-time per tunnel URL)

Vipps webhooks are opt-in. Register your callback URL once, capture
the returned secret:

```bash
bash scripts/register-vipps-webhook.sh
```

The script reads your credentials from `.env.test-payments`, fetches
an access token, POSTs `/webhooks/v1/webhooks` with the api tunnel URL,
and writes the returned `MOBILEPAY_WEBHOOK_SECRET` back into the
overlay. Restart the test stack afterwards.

## Magic test amounts

Set the payment amount (in minor units / øre / cents) to trigger
specific responses:

| Amount | Result                              |
|-------:|-------------------------------------|
|    151 | Insufficient funds                  |
|    182 | Refused by issuer                   |
|    183 | Suspected fraud                     |
|    186 | Expired card                        |
|    197 | 3D Secure denied                    |
|    201 | Unknown result for 1 hour (tests retry / dunning) |

Any other amount = normal flow (donor approves in the MT app).

## URL validation rules

- `callbackPrefix` URLs **must use HTTPS**
- `localhost` is **rejected**; `127.0.0.1` is accepted (but won't help
  for inbound webhooks — use a tunnel)
- TLS 1.2 minimum
- Hostnames must resolve via public DNS — Cloudflare Tunnel and ngrok
  work; `.local` and private IPs don't

## How to test end-to-end

1. Complete steps 1-3 above (register, install app, set creds)
2. Start the test stack: `bash scripts/payment-test-up.sh`
3. Run `bash scripts/register-vipps-webhook.sh`
4. Restart the stack so the api picks up `MOBILEPAY_WEBHOOK_SECRET`
5. Open the printed web tunnel URL → `/en/plants`
6. Pick a plant → Adopt → choose MobilePay
7. The MT app on your phone pops up asking to approve
8. Approve with PIN `1236`
9. Browser redirects to `/donate/complete`; webhook
   `epayment.captured.v1` fires; adoption activates

## Going to production

When real Vipps credentials arrive:

```diff
- MOBILEPAY_API_URL=https://apitest.vipps.no
+ MOBILEPAY_API_URL=https://api.vipps.no
- MOBILEPAY_CLIENT_ID=<test value>
+ MOBILEPAY_CLIENT_ID=<real value>
# (same for CLIENT_SECRET, SUBSCRIPTION_KEY, MERCHANT_SERIAL_NUMBER)
```

Then re-register the webhook against **production** Vipps (the script
honours `MOBILEPAY_API_URL`, so it picks the right env). Capture the
new `MOBILEPAY_WEBHOOK_SECRET` and put it in production `.env`.

No code changes needed.

## Source documentation

- [Vipps test environment overview](https://developer.vippsmobilepay.com/docs/knowledge-base/test-environment/)
- [Webhooks API auth](https://developer.vippsmobilepay.com/docs/APIs/webhooks-api/request-authentication/)
- [URL validation rules](https://developer.vippsmobilepay.com/docs/knowledge-base/url-validation/)
- [Recurring API](https://developer.vippsmobilepay.com/docs/APIs/recurring-api/)
