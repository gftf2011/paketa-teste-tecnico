import { Counter, Meter, metrics } from '@opentelemetry/api';

/**
 * Resultado de uma leitura do menu no cache:
 * - hit: servida da memória;
 * - miss: foi ao banco;
 * - coalesced: aguardou uma consulta ao banco já em andamento (single-flight).
 */
export type MenuCacheResult = 'hit' | 'miss' | 'coalesced';

/**
 * Métricas de negócio do menu. Usa só a API do OpenTelemetry: sem o SDK
 * inicializado (ex.: nos testes) os instrumentos não fazem nada.
 */
export class MenuMetrics {
  private readonly cacheRequests: Counter;
  private readonly itemsCreated: Counter;
  private readonly itemsDeleted: Counter;

  constructor(meter: Meter = metrics.getMeter('menu-api')) {
    this.cacheRequests = meter.createCounter('menu.cache.requests', {
      description: 'Leituras do menu completo, por resultado no cache',
      unit: '{request}',
    });
    this.itemsCreated = meter.createCounter('menu.items.created', {
      description: 'Itens de menu criados',
      unit: '{item}',
    });
    this.itemsDeleted = meter.createCounter('menu.items.deleted', {
      description: 'Itens de menu excluídos, incluindo sub-itens removidos em cascata',
      unit: '{item}',
    });
  }

  recordCacheRequest(result: MenuCacheResult): void {
    this.cacheRequests.add(1, { 'menu.cache.result': result });
  }

  recordItemCreated(): void {
    this.itemsCreated.add(1);
  }

  recordItemsDeleted(count: number): void {
    this.itemsDeleted.add(count);
  }
}
