import { CacheInvalidationBus } from './cache-invalidation-bus';

/**
 * Barramento em memória: conecta "instâncias" dentro do mesmo processo.
 * Útil para testes e para simular várias instâncias sem Redis.
 */
export class InMemoryCacheInvalidationBroker {
  private readonly buses = new Set<InMemoryCacheInvalidationBus>();

  createBus(): InMemoryCacheInvalidationBus {
    const bus = new InMemoryCacheInvalidationBus(this);
    this.buses.add(bus);
    return bus;
  }

  /** @internal */
  deliver(from: InMemoryCacheInvalidationBus): void {
    for (const bus of this.buses) {
      if (bus !== from) bus.receive();
    }
  }

  /** @internal */
  remove(bus: InMemoryCacheInvalidationBus): void {
    this.buses.delete(bus);
  }
}

export class InMemoryCacheInvalidationBus implements CacheInvalidationBus {
  private readonly handlers: Array<() => void> = [];

  constructor(private readonly broker: InMemoryCacheInvalidationBroker) {}

  async publish(): Promise<void> {
    this.broker.deliver(this);
  }

  async subscribe(onInvalidate: () => void): Promise<void> {
    this.handlers.push(onInvalidate);
  }

  async close(): Promise<void> {
    this.broker.remove(this);
  }

  /** @internal */
  receive(): void {
    for (const handler of this.handlers) handler();
  }
}
