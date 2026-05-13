/**
 * BloomOulu load test — k6 script.
 *
 * Three scenarios run in parallel and each enforces an SLO threshold:
 *
 *   browse_home      30 RPS for 10 min on /fi  (cached ISR; target <100ms p95)
 *   browse_plant     30 RPS for 10 min on /fi/plants/[slug] (random plant;
 *                                                            cached ISR;
 *                                                            target <120ms p95)
 *   submit_adoption  5 RPS for 5 min on POST /v1/adoptions (sandbox provider;
 *                                                          target <1s p95)
 *   webhook_replay  100 RPS for 60s on POST /webhooks/paytrail
 *                   with valid HMAC; target <500ms p95 idempotent
 *                   (duplicates absorbed by ProcessedEvent UNIQUE).
 *
 * Run against staging only — never production.
 *
 * Usage:
 *   $ k6 run \
 *       -e BASE_URL=https://staging.bloomoulu.fi \
 *       -e API_URL=https://api.staging.bloomoulu.fi \
 *       -e PAYTRAIL_SECRET=… \
 *       scripts/loadtest.k6.js
 *
 * Defaults assume the dev stack at localhost (k6 from the host).
 */
import http from 'k6/http';
import crypto from 'k6/crypto';
import { check, sleep } from 'k6';
import { Counter, Trend } from 'k6/metrics';
import exec from 'k6/execution';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const API_URL = __ENV.API_URL || 'http://localhost:4000';
const PAYTRAIL_SECRET = __ENV.PAYTRAIL_SECRET || 'SAIPPUAKAUPPIAS';

const PLANT_SLUGS = [
  'pulsatilla-patens',
  'arctostaphylos-alpina',
  'campanula-uniflora',
  'rubus-chamaemorus',
  'andromeda-polifolia',
  'menyanthes-trifoliata',
  'vaccinium-myrtillus',
  'cinna-latifolia',
  'agrostis-clavata',
];

const adoptionsCreated = new Counter('bloomoulu_adoptions_created');
const webhookLatency = new Trend('bloomoulu_webhook_latency_ms');

export const options = {
  scenarios: {
    browse_home: {
      executor: 'constant-arrival-rate',
      rate: 30,
      timeUnit: '1s',
      duration: '10m',
      preAllocatedVUs: 50,
      maxVUs: 100,
      exec: 'browseHome',
      tags: { scenario: 'browse_home' },
    },
    browse_plant: {
      executor: 'constant-arrival-rate',
      rate: 30,
      timeUnit: '1s',
      duration: '10m',
      preAllocatedVUs: 50,
      maxVUs: 100,
      exec: 'browsePlant',
      tags: { scenario: 'browse_plant' },
    },
    submit_adoption: {
      executor: 'constant-arrival-rate',
      rate: 5,
      timeUnit: '1s',
      duration: '5m',
      preAllocatedVUs: 20,
      maxVUs: 50,
      exec: 'submitAdoption',
      tags: { scenario: 'submit_adoption' },
    },
    webhook_replay: {
      executor: 'constant-arrival-rate',
      rate: 100,
      timeUnit: '1s',
      duration: '60s',
      preAllocatedVUs: 100,
      maxVUs: 200,
      exec: 'webhookReplay',
      tags: { scenario: 'webhook_replay' },
    },
  },
  thresholds: {
    'http_req_duration{scenario:browse_home}': ['p(95)<100'],
    'http_req_duration{scenario:browse_plant}': ['p(95)<120'],
    'http_req_duration{scenario:submit_adoption}': ['p(95)<1000'],
    'http_req_duration{scenario:webhook_replay}': ['p(95)<500'],
    http_req_failed: ['rate<0.01'],
  },
};

export function browseHome() {
  const res = http.get(`${BASE_URL}/fi`, { tags: { scenario: 'browse_home' } });
  check(res, { 'home 200': (r) => r.status === 200 });
}

export function browsePlant() {
  const slug = PLANT_SLUGS[Math.floor(Math.random() * PLANT_SLUGS.length)];
  const res = http.get(`${BASE_URL}/fi/plants/${slug}`, {
    tags: { scenario: 'browse_plant' },
  });
  check(res, { 'plant 200': (r) => r.status === 200 });
}

export function submitAdoption() {
  const slug = PLANT_SLUGS[Math.floor(Math.random() * PLANT_SLUGS.length)];
  const body = JSON.stringify({
    plantSlug: slug,
    tierId: 'seedling',
    intent: 'for_self',
    recurring: false,
    billingInterval: 'one_time',
    donor: {
      email: `k6-${exec.vu.idInTest}-${Date.now()}@bloomoulu.test`,
      name: 'k6 Load Donor',
      locale: 'fi',
      countryCode: 'FI',
    },
    preferredProvider: 'bank_transfer',
  });
  const res = http.post(`${API_URL}/v1/adoptions`, body, {
    headers: { 'content-type': 'application/json' },
    tags: { scenario: 'submit_adoption' },
  });
  check(res, { 'adoption 201': (r) => r.status >= 200 && r.status < 300 });
  if (res.status < 300) adoptionsCreated.add(1);
}

/**
 * Replay a Paytrail-style webhook with a valid HMAC signature.
 * The event id is deliberately reused across iterations so the
 * idempotency gate (ProcessedEvent UNIQUE) absorbs every duplicate.
 * What we're testing is that the gate scales under burst load.
 */
export function webhookReplay() {
  const evtId = `loadtest-${exec.scenario.iterationInTest % 50}`;
  const body = JSON.stringify({
    transactionId: 'tx_load_' + evtId,
    status: 'ok',
    amount: 2500,
    reference: 'RF18 LOAD TEST 0001',
    stamp: evtId,
  });

  const headers = {
    'checkout-account': '375917',
    'checkout-algorithm': 'sha256',
    'checkout-method': 'POST',
    'checkout-nonce': evtId,
    'checkout-timestamp': new Date().toISOString(),
    'checkout-transaction-id': 'tx_load_' + evtId,
    'content-type': 'application/json',
  };

  // Paytrail HMAC-SHA256 over canonicalised checkout-* headers + body.
  const canonical =
    Object.keys(headers)
      .filter((k) => k.startsWith('checkout-'))
      .sort()
      .map((k) => `${k}:${headers[k]}`)
      .join('\n') +
    '\n' +
    body;
  const sig = crypto.hmac('sha256', PAYTRAIL_SECRET, canonical, 'hex');
  headers['signature'] = sig;

  const t0 = Date.now();
  const res = http.post(`${API_URL}/webhooks/paytrail`, body, {
    headers,
    tags: { scenario: 'webhook_replay' },
  });
  webhookLatency.add(Date.now() - t0);
  check(res, { 'webhook 200 or 202': (r) => r.status === 200 || r.status === 202 });
}
