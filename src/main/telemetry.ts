import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { ExpressInstrumentation, ExpressLayerType } from '@opentelemetry/instrumentation-express';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { IORedisInstrumentation } from '@opentelemetry/instrumentation-ioredis';
import { MongoDBInstrumentation } from '@opentelemetry/instrumentation-mongodb';
import { RuntimeNodeInstrumentation } from '@opentelemetry/instrumentation-runtime-node';
import { AggregationType, PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { ParentBasedSampler, TraceIdRatioBasedSampler } from '@opentelemetry/sdk-trace';

/**
 * Inicializa o OpenTelemetry (traces e métricas, exportados via OTLP/HTTP).
 *
 * Precisa ser o primeiro import do processo: as instrumentações só
 * interceptam http, express, mongodb e ioredis se forem registradas antes desses
 * módulos serem carregados.
 *
 * Fica desligado enquanto OTEL_EXPORTER_OTLP_ENDPOINT não for definido, para
 * não gerar erros de exportação quando não há coletor. Demais ajustes usam as
 * variáveis padrão do OpenTelemetry (OTEL_SERVICE_NAME, OTEL_TRACES_SAMPLER_ARG,
 * OTEL_METRIC_EXPORT_INTERVAL, OTEL_SDK_DISABLED...).
 */
const env = process.env;
const enabled = Boolean(env.OTEL_EXPORTER_OTLP_ENDPOINT) && env.OTEL_SDK_DISABLED !== 'true';

/**
 * Buckets (em segundos) da latência HTTP. Os padrão começam em 5 ms, mas a
 * API costuma responder abaixo de 1 ms: sem buckets finos, p50/p95 virariam
 * só uma interpolação dentro do primeiro bucket.
 */
const HTTP_DURATION_BUCKETS = [
  0.0001, 0.00025, 0.0005, 0.001, 0.0025, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5,
];

const ratio = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  return value !== undefined && parsed >= 0 && parsed <= 1 ? parsed : fallback;
};

let sdk: NodeSDK | undefined;

if (enabled) {
  sdk = new NodeSDK({
    serviceName: env.OTEL_SERVICE_NAME || 'menu-api',
    traceExporter: new OTLPTraceExporter(),
    // Amostragem por proporção, respeitando a decisão de quem chamou: sob
    // carga alta, registrar 100% dos traces custa CPU e armazenamento.
    sampler: new ParentBasedSampler({
      root: new TraceIdRatioBasedSampler(ratio(env.OTEL_TRACES_SAMPLER_ARG, 1)),
    }),
    metricReaders: [
      new PeriodicExportingMetricReader({
        exporter: new OTLPMetricExporter(),
        exportIntervalMillis: Number(env.OTEL_METRIC_EXPORT_INTERVAL) || 15_000,
      }),
    ],
    views: [
      {
        instrumentName: 'http.server.request.duration',
        aggregation: {
          type: AggregationType.EXPLICIT_BUCKET_HISTOGRAM,
          options: { boundaries: HTTP_DURATION_BUCKETS },
        },
      },
    ],
    instrumentations: [
      new HttpInstrumentation({
        ignoreIncomingRequestHook: (req) => req.url === '/health',
      }),
      // Só os handlers de rota viram spans. Middlewares (json, compression)
      // e camadas de router criariam spans em toda requisição, com custo de
      // CPU e sem informação útil: a rota já vai no span HTTP (http.route).
      new ExpressInstrumentation({
        ignoreLayersType: [ExpressLayerType.MIDDLEWARE, ExpressLayerType.ROUTER],
      }),
      new MongoDBInstrumentation(),
      new IORedisInstrumentation(),
      new RuntimeNodeInstrumentation(),
    ],
  });
  sdk.start();
  console.log(`OpenTelemetry ativo, exportando para ${env.OTEL_EXPORTER_OTLP_ENDPOINT}`);
}

/** Envia o que estiver pendente e encerra o SDK. */
export async function shutdownTelemetry(): Promise<void> {
  await sdk?.shutdown();
}
