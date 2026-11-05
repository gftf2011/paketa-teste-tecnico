import { MenuItem, MenuItemId, MenuItemRepository } from '../../../domain';
import { CacheInvalidationBus } from '../../../../shared/infra/cache-invalidation/cache-invalidation-bus';
import { MenuMetrics } from '../../observability/menu-metrics';

export interface CachedMenuItemRepositoryOptions {
  metrics?: MenuMetrics;
  /**
   * Barramento para sincronizar o cache entre instâncias. Sem ele, escritas
   * de outras instâncias só aparecem quando o TTL vence.
   */
  invalidationBus?: CacheInvalidationBus;
  /**
   * Janela, em ms, para agrupar avisos de outras instâncias (e TTLs vencidos)
   * numa única recarga em segundo plano. Padrão: 50 ms.
   */
  refreshDelayMs?: number;
  /** Relógio injetável, para os testes. */
  now?: () => number;
}

interface CacheEntry {
  items: MenuItem[];
  expiresAt: number;
  /** Há uma versão mais nova no banco; recarga em segundo plano agendada. */
  stale: boolean;
}

/**
 * Decorator que mantém o menu completo (`findAll`) em memória.
 *
 * O menu é lido muito mais do que alterado, então o cache evita uma ida ao
 * banco por requisição de leitura:
 * - cada escrita, feita aqui ou avisada por outra instância via
 *   `invalidationBus`, torna o cache "stale": as leituras continuam
 *   respondendo com a versão anterior, sem esperar o banco, enquanto uma
 *   única recarga roda em segundo plano (stale-while-revalidate). Escritas
 *   em rajada dentro de `refreshDelayMs` viram uma recarga só;
 * - o preço é que, por cerca de `refreshDelayMs` + uma consulta, uma leitura
 *   pode devolver a versão anterior, inclusive na instância que escreveu.
 *   Atrás de um balanceador round robin isso já valia: a leitura seguinte
 *   do cliente cai, em geral, em outra instância;
 * - o TTL continua valendo como rede de segurança (sem barramento, ou se um
 *   aviso se perder) e, ao vencer, também dispara a recarga em segundo plano;
 * - leituras simultâneas com o cache vazio compartilham uma única consulta
 *   (single-flight);
 * - uma consulta iniciada antes de uma escrita nunca é guardada como atual.
 */
export class CachedMenuItemRepository implements MenuItemRepository {
  private cache: CacheEntry | null = null;
  private inflight: Promise<MenuItem[]> | null = null;
  private refreshTimer: NodeJS.Timeout | null = null;
  private version = 0;

  private readonly metrics: MenuMetrics;
  private readonly now: () => number;
  private readonly invalidationBus?: CacheInvalidationBus;
  private readonly refreshDelayMs: number;

  constructor(
    private readonly inner: MenuItemRepository,
    private readonly ttlMs: number,
    options: CachedMenuItemRepositoryOptions = {},
  ) {
    this.metrics = options.metrics ?? new MenuMetrics();
    this.now = options.now ?? Date.now;
    this.invalidationBus = options.invalidationBus;
    this.refreshDelayMs = options.refreshDelayMs ?? 50;
  }

  /** Passa a reagir quando outra instância avisar de uma escrita. */
  async listenForRemoteInvalidations(): Promise<void> {
    await this.invalidationBus?.subscribe(() => this.markStale('remote'));
  }

  async create(item: MenuItem): Promise<void> {
    await this.inner.create(item);
    await this.invalidateEverywhere();
  }

  findById(id: MenuItemId): Promise<MenuItem | null> {
    return this.inner.findById(id);
  }

  async findAll(): Promise<MenuItem[]> {
    const cache = this.cache;

    if (cache && !cache.stale && cache.expiresAt > this.now()) {
      this.metrics.recordCacheRequest('hit');
      return cache.items;
    }
    if (cache) {
      cache.stale = true;
      this.scheduleRefresh();
      this.metrics.recordCacheRequest('stale');
      return cache.items;
    }
    if (this.inflight) {
      this.metrics.recordCacheRequest('coalesced');
      return this.inflight;
    }
    this.metrics.recordCacheRequest('miss');
    return this.load();
  }

  async deleteWithDescendants(id: MenuItemId): Promise<number> {
    const deletedCount = await this.inner.deleteWithDescendants(id);
    if (deletedCount > 0) await this.invalidateEverywhere();
    return deletedCount;
  }

  private load(): Promise<MenuItem[]> {
    const version = this.version;
    const request: Promise<MenuItem[]> = this.inner
      .findAll()
      .then((items) => {
        if (version === this.version) {
          this.cache = { items, expiresAt: this.now() + this.ttlMs, stale: false };
        }
        return items;
      })
      .finally(() => {
        if (this.inflight === request) this.inflight = null;
        // Chegou outro aviso durante a consulta: o resultado já nasceu velho.
        // Reagenda só aqui, depois de liberar `inflight`, senão o agendamento
        // seria ignorado por achar que ainda há uma recarga a caminho.
        if (version !== this.version && this.cache?.stale) this.scheduleRefresh();
      });

    this.inflight = request;
    return request;
  }

  /** Agenda uma recarga em segundo plano, se ainda não houver uma a caminho. */
  private scheduleRefresh(): void {
    if (this.refreshTimer || this.inflight) return;

    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = null;
      this.load().catch((error: unknown) => {
        // Segue servindo a versão anterior; a próxima leitura agenda outra tentativa.
        const reason = error instanceof Error ? error.message : String(error);
        console.warn(`Falha ao recarregar o menu em segundo plano: ${reason}`);
      });
    }, this.refreshDelayMs);
    this.refreshTimer.unref();
  }

  /** Houve uma escrita: o que está em memória ficou desatualizado. */
  private markStale(source: 'local' | 'remote'): void {
    this.metrics.recordCacheInvalidation(source);
    this.version++;
    if (this.cache) {
      this.cache.stale = true;
      this.scheduleRefresh();
    } else {
      // Sem cópia para servir: quem chegar depois busca no banco.
      this.inflight = null;
    }
  }

  /**
   * Marca o cache local como desatualizado e avisa as outras instâncias. Uma
   * falha no aviso não desfaz nem falha a escrita, que já foi persistida: as
   * outras instâncias se atualizam pelo TTL.
   */
  private async invalidateEverywhere(): Promise<void> {
    this.markStale('local');

    if (!this.invalidationBus) return;
    try {
      await this.invalidationBus.publish();
    } catch (error) {
      this.metrics.recordInvalidationPublishFailure();
      const reason = error instanceof Error ? error.message : String(error);
      console.warn(`Falha ao avisar as outras instâncias sobre a escrita no menu: ${reason}`);
    }
  }
}
