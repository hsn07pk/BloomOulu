export const dynamic = 'force-dynamic';

/**
 * Prometheus metrics endpoint for the web tier. Counts page render times via
 * an in-memory histogram exposed in the OpenMetrics format. Real request-level
 * metrics flow through OpenTelemetry to Tempo; this endpoint is just a beacon
 * so Prometheus can confirm the web container is alive.
 */
export async function GET() {
  const body = [
    '# HELP bloomoulu_web_up Web container is responding',
    '# TYPE bloomoulu_web_up gauge',
    'bloomoulu_web_up 1',
  ].join('\n') + '\n';
  return new Response(body, { headers: { 'content-type': 'text/plain; version=0.0.4' } });
}
