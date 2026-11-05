import { Counter, Meter, metrics } from '@opentelemetry/api';

/**
 * Resultado de uma leitura do menu no cache:
 * - hit: servida da memória;
 * - stale: servida da memória com a versão anterior, enquanto a nova é
 *   recarregada em segundo plano (stale-while-revalidate);
 * - miss: foi ao banco;
 * - coalesced: aguardou uma consulta ao banco já em andamento (single-flight).
 */
export type MenuCacheResult = 'hit' | 'stale' | 'miss' | 'coalesced';

/**
 * Origem de uma invalidação do cache:
 * - local: escrita feita por esta instância;
 * - remote: aviso de outra instância (ou reconexão ao barramento).
 */
export type MenuCacheInvalidationSource = 'local' | 'remote';

/**
 * Métricas de negócio do menu. Usa só a API do OpenTelemetry: sem o SDK
 * inicializado (ex.: nos testes) os instrumentos não fazem nada.
 */
export class MenuMetrics {
  private readonly cacheRequests: Counter;
  private readonly itemsCreated: Counter;
  private readonly itemsDeleted: Counter;
  private readonly cacheInvalidations: Counter;
  private readonly invalidationPublishFailures: Counter;

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
    this.cacheInvalidations = meter.createCounter('menu.cache.invalidations', {
      description: 'Invalidações do cache do menu, por origem',
      unit: '{invalidation}',
    });
    this.invalidationPublishFailures = meter.createCounter('menu.cache.invalidation.publish_failures', {
      description: 'Avisos de invalidação que não puderam ser enviados às outras instâncias',
      unit: '{failure}',
    });
  }

  recordCacheRequest(result: MenuCacheResult): void {
    this.cacheRequests.add(1, { 'menu.cache.result': result });
  }

  recordCacheInvalidation(source: MenuCacheInvalidationSource): void {
    this.cacheInvalidations.add(1, { 'menu.cache.invalidation.source': source });
  }

  recordInvalidationPublishFailure(): void {
    this.invalidationPublishFailures.add(1);
  }

  recordItemCreated(): void {
    this.itemsCreated.add(1);
  }

  recordItemsDeleted(count: number): void {
    this.itemsDeleted.add(count);
  }
}
