import Redis from 'ioredis';
import { RedisCacheInvalidationBus } from './redis-cache-invalidation-bus';

/**
 * Teste de integração com um Redis real. Roda quando REDIS_URL está definido:
 *   REDIS_URL=redis://localhost:6379 npm test
 */
const REDIS_URL = process.env.REDIS_URL;
const describeWithRedis = REDIS_URL ? describe : describe.skip;

describeWithRedis('RedisCacheInvalidationBus', () => {
  const channel = `test:cache:${Date.now()}`;
  const buses: RedisCacheInvalidationBus[] = [];

  const createBus = async () => {
    const bus = new RedisCacheInvalidationBus(REDIS_URL!, channel);
    buses.push(bus);
    const onInvalidate = jest.fn();
    await bus.subscribe(onInvalidate);
    onInvalidate.mockClear(); // ignora o aviso da conexão inicial
    return { bus, onInvalidate };
  };

  const waitFor = async (assertion: () => void | Promise<void>, timeoutMs = 2_000) => {
    const start = Date.now();
    for (;;) {
      try {
        return await assertion();
      } catch (error) {
        if (Date.now() - start > timeoutMs) throw error;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    }
  };

  afterAll(async () => {
    await Promise.all(buses.map((bus) => bus.close()));
  });

  it('entrega o aviso às outras instâncias e não à que publicou', async () => {
    const a = await createBus();
    const b = await createBus();
    const c = await createBus();

    await a.bus.publish();

    await waitFor(() => {
      expect(b.onInvalidate).toHaveBeenCalledTimes(1);
      expect(c.onInvalidate).toHaveBeenCalledTimes(1);
    });
    expect(a.onInvalidate).not.toHaveBeenCalled();
  });

  it('avisa o assinante e volta a receber mensagens após uma reconexão', async () => {
    const a = await createBus();
    const b = await createBus();
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    jest.spyOn(console, 'log').mockImplementation(() => undefined);

    // Derruba as conexões de subscribe, como numa queda de rede.
    const admin = new Redis(REDIS_URL!);
    await admin.client('KILL', 'TYPE', 'pubsub');
    await admin.quit();

    await waitFor(() => expect(b.onInvalidate).toHaveBeenCalled());
    b.onInvalidate.mockClear();

    await waitFor(async () => {
      await a.bus.publish();
      expect(b.onInvalidate).toHaveBeenCalled();
    });
  });
});
