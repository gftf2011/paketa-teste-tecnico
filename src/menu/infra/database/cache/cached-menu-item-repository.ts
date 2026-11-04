import { MenuItem, MenuItemId, MenuItemRepository } from '../../../domain';

/**
 * Decorator que mantém o menu completo (`findAll`) em memória.
 *
 * O menu é lido muito mais do que alterado, então o cache evita uma ida ao
 * banco por requisição de leitura:
 * - escritas feitas por esta instância invalidam o cache na hora;
 * - escritas feitas por outras instâncias aparecem em até `ttlMs`;
 * - leituras simultâneas com o cache vazio compartilham uma única consulta
 *   (single-flight), evitando rajadas no banco quando o cache expira;
 * - uma consulta iniciada antes de uma escrita nunca repopula o cache com
 *   dados anteriores a ela.
 */
export class CachedMenuItemRepository implements MenuItemRepository {
  private cache: { items: MenuItem[]; expiresAt: number } | null = null;
  private inflight: Promise<MenuItem[]> | null = null;
  private version = 0;

  constructor(
    private readonly inner: MenuItemRepository,
    private readonly ttlMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  async create(item: MenuItem): Promise<void> {
    await this.inner.create(item);
    this.invalidate();
  }

  findById(id: MenuItemId): Promise<MenuItem | null> {
    return this.inner.findById(id);
  }

  async findAll(): Promise<MenuItem[]> {
    if (this.cache && this.cache.expiresAt > this.now()) {
      return this.cache.items;
    }
    return this.inflight ?? this.load();
  }

  async deleteWithDescendants(id: MenuItemId): Promise<number> {
    const deletedCount = await this.inner.deleteWithDescendants(id);
    if (deletedCount > 0) this.invalidate();
    return deletedCount;
  }

  private load(): Promise<MenuItem[]> {
    const version = this.version;
    const request: Promise<MenuItem[]> = this.inner
      .findAll()
      .then((items) => {
        if (version === this.version) {
          this.cache = { items, expiresAt: this.now() + this.ttlMs };
        }
        return items;
      })
      .finally(() => {
        if (this.inflight === request) this.inflight = null;
      });

    this.inflight = request;
    return request;
  }

  private invalidate(): void {
    this.version++;
    this.cache = null;
    this.inflight = null;
  }
}
