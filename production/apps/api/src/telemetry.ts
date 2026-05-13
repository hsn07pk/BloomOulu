import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';

if (process.env.NODE_ENV !== 'test') {
  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  const sdk = new NodeSDK({
    serviceName: 'bloomoulu-api',
    traceExporter: endpoint
      ? new OTLPTraceExporter({ url: `${endpoint}/v1/traces` })
      : undefined,
    instrumentations: [
      getNodeAutoInstrumentations({
        '@opentelemetry/instrumentation-fs': { enabled: false },
      }),
    ],
  });
  sdk.start();
  process.on('SIGTERM', () => sdk.shutdown().catch(() => {}));
}
