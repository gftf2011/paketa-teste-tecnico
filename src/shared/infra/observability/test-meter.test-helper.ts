import { Attributes, Meter } from '@opentelemetry/api';
import { MeterProvider, MetricReader } from '@opentelemetry/sdk-metrics';

class InMemoryMetricReader extends MetricReader {
  protected async onForceFlush(): Promise<void> {}
  protected async onShutdown(): Promise<void> {}
}

/**
 * Meter isolado para testes, com leitura sob demanda dos valores gravados.
 * `sum` soma os pontos de um contador cujos atributos contêm `attributes`.
 */
export function createTestMeter(): {
  meter: Meter;
  sum: (name: string, attributes?: Attributes) => Promise<number>;
} {
  const reader = new InMemoryMetricReader();
  const provider = new MeterProvider({ readers: [reader] });

  const sum = async (name: string, attributes: Attributes = {}): Promise<number> => {
    const { resourceMetrics } = await reader.collect();
    let total = 0;
    for (const scope of resourceMetrics.scopeMetrics) {
      for (const metric of scope.metrics) {
        if (metric.descriptor.name !== name) continue;
        for (const point of metric.dataPoints) {
          const matches = Object.entries(attributes).every(([k, v]) => point.attributes[k] === v);
          if (matches) total += point.value as number;
        }
      }
    }
    return total;
  };

  return { meter: provider.getMeter('test'), sum };
}
