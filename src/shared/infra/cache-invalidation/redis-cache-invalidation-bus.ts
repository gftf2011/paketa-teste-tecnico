import { randomUUID } from 'node:crypto';
import Redis from 'ioredis';
import { CacheInvalidationBus } from './cache-invalidation-bus';

/**
 * Barramento via Redis Pub/Sub. Cada instância publica o próprio id no
 * canal, e ignora as mensagens com esse id.
 *
 * Usa duas conexões, porque uma conexão em modo subscribe não pode publicar.
 * O Redis fica fora do caminho crítico:
 * - a conexão de publicação não enfileira comandos enquanto está offline, então
 *   `publish` falha na hora em vez de segurar a requisição de escrita;
 * - a cada (re)conexão o canal é assinado de novo (o ioredis só reassina
 *   canais cuja assinatura já tinha dado certo, o que não acontece se a
 *   aplicação subir com o Redis fora do ar) e o assinante é avisado, porque
 *   mensagens enviadas durante a queda foram perdidas.
 */
export class RedisCacheInvalidationBus implements CacheInvalidationBus {
  private readonly instanceId = randomUUID();
  private readonly publisher: Redis;
  private readonly subscriber: Redis;
  private connected = true;

  constructor(
    url: string,
    private readonly channel: string,
  ) {
    this.publisher = new Redis(url, {
      connectTimeout: 2_000,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
    });
    this.subscriber = new Redis(url, { connectTimeout: 2_000, maxRetriesPerRequest: null });

    for (const connection of [this.publisher, this.subscriber]) {
      connection.on('error', (error: Error) => this.logUnavailable(error));
    }
  }

  async publish(): Promise<void> {
    await this.publisher.publish(this.channel, this.instanceId);
  }

  async subscribe(onInvalidate: () => void): Promise<void> {
    this.subscriber.on('message', (channel: string, sender: string) => {
      if (channel === this.channel && sender !== this.instanceId) onInvalidate();
    });
    this.subscriber.on('ready', () => {
      if (!this.connected) console.log('Redis reconectado: cache local descartado');
      this.connected = true;
      this.subscriber.subscribe(this.channel).catch(() => undefined);
      onInvalidate();
    });

    await this.subscriber.subscribe(this.channel);
  }

  async close(): Promise<void> {
    await Promise.allSettled([this.publisher.quit(), this.subscriber.quit()]);
  }

  /** Loga só a transição para indisponível, não cada tentativa de reconexão. */
  private logUnavailable(error: Error): void {
    if (!this.connected) return;
    this.connected = false;
    console.warn(`Redis indisponível (${error.message}): caches sincronizados só pelo TTL até reconectar`);
  }
}
