import { MenuItem } from '../../../domain';
import { InMemoryMenuItemRepository } from '../in-memory/in-memory-menu-item-repository';
import { describeMenuItemRepositoryContract } from '../menu-item-repository.contract';
import { CacheInvalidationBus } from '../../../../shared/infra/cache-invalidation/cache-invalidation-bus';
import { InMemoryCacheInvalidationBroker } from '../../../../shared/infra/cache-invalidation/in-memory-cache-invalidation-bus';
import { createTestMeter } from '../../../../shared/infra/observability/test-meter.test-helper';
import { MenuMetrics } from '../../observability/menu-metrics';
import { CachedMenuItemRepository } from './cached-menu-item-repository';

describeMenuItemRepositoryContract('CachedMenuItemRepository', () => {
  let repository: CachedMenuItemRepository;

  beforeEach(() => {
    repository = new CachedMenuItemRepository(new InMemoryMenuItemRepository(), 60_000);
  });

  return { getRepository: () => repository };
});

/** Deixa rodar timers e promessas pendentes (recargas em segundo plano). */
const settle = (ms = 10) => new Promise((resolve) => setTimeout(resolve, ms));

describe('CachedMenuItemRepository (cache)', () => {
  const TTL = 1_000;
  let inner: InMemoryMenuItemRepository;
  let clock: number;
  let sut: CachedMenuItemRepository;

  beforeEach(() => {
    inner = new InMemoryMenuItemRepository();
    clock = 0;
    sut = new CachedMenuItemRepository(inner, TTL, { now: () => clock, refreshDelayMs: 0 });
  });

  it('serve leituras seguintes do cache dentro do TTL', async () => {
    const spy = jest.spyOn(inner, 'findAll');

    await sut.findAll();
    clock += TTL - 1;
    await sut.findAll();

    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('com o TTL vencido, responde com a versão anterior e recarrega em segundo plano', async () => {
    const spy = jest.spyOn(inner, 'findAll');
    await sut.findAll();
    await inner.create(MenuItem.create({ name: 'Criado por outra instância' }));
    clock += TTL;

    expect(await sut.findAll()).toHaveLength(0);
    await settle();

    expect(spy).toHaveBeenCalledTimes(2);
    expect(await sut.findAll()).toHaveLength(1);
  });

  it('não espera o banco quando o TTL vence', async () => {
    await sut.findAll();
    clock += TTL;
    let release!: () => void;
    jest.spyOn(inner, 'findAll').mockImplementationOnce(
      () => new Promise((resolve) => (release = () => resolve([]))),
    );

    // Responderia na hora mesmo com o banco travado.
    await expect(sut.findAll()).resolves.toEqual([]);
    await settle();
    release();
  });

  it('se a recarga em segundo plano falha, segue com a versão anterior e tenta de novo', async () => {
    await sut.findAll();
    await inner.create(MenuItem.create({ name: 'Informática' }));
    clock += TTL;
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    jest.spyOn(inner, 'findAll').mockRejectedValueOnce(new Error('MongoDB fora do ar'));

    expect(await sut.findAll()).toHaveLength(0);
    await settle();
    expect(await sut.findAll()).toHaveLength(0);
    await settle();

    expect(await sut.findAll()).toHaveLength(1);
  });

  it('compartilha uma única consulta entre leituras simultâneas', async () => {
    const spy = jest.spyOn(inner, 'findAll');

    await Promise.all(Array.from({ length: 50 }, () => sut.findAll()));

    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('ao criar um item, serve a versão anterior e recarrega em segundo plano', async () => {
    await sut.findAll();
    await sut.create(MenuItem.create({ name: 'Informática' }));

    expect(await sut.findAll()).toHaveLength(0);
    await settle();
    expect(await sut.findAll()).toHaveLength(1);
  });

  it('ao excluir um item, serve a versão anterior e recarrega em segundo plano', async () => {
    const item = MenuItem.create({ name: 'Informática' });
    await sut.create(item);
    await sut.findAll();

    await sut.deleteWithDescendants(item.id);

    expect(await sut.findAll()).toHaveLength(1);
    await settle();
    expect(await sut.findAll()).toHaveLength(0);
  });

  it('sem cópia em memória, a leitura após uma escrita vai direto ao banco', async () => {
    await sut.create(MenuItem.create({ name: 'Informática' }));

    expect(await sut.findAll()).toHaveLength(1);
  });

  it('não invalida o cache quando a escrita falha', async () => {
    await sut.create(MenuItem.create({ name: 'Informática' }));
    await sut.findAll();
    const spy = jest.spyOn(inner, 'findAll');

    await expect(sut.create(MenuItem.create({ name: 'Informática' }))).rejects.toThrow();
    await sut.findAll();

    expect(spy).not.toHaveBeenCalled();
  });

  it('não guarda no cache uma leitura iniciada antes de uma escrita', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const realFindAll = inner.findAll.bind(inner);
    jest.spyOn(inner, 'findAll').mockImplementationOnce(async () => {
      const snapshot = await realFindAll();
      await gate;
      return snapshot;
    });

    const staleRead = sut.findAll();
    await sut.create(MenuItem.create({ name: 'Informática' }));
    release();

    expect(await staleRead).toHaveLength(0);
    expect(await sut.findAll()).toHaveLength(1);
  });
});

describe('CachedMenuItemRepository (métricas)', () => {
  it('registra hit, miss e coalesced', async () => {
    const { meter, sum } = createTestMeter();
    const sut = new CachedMenuItemRepository(new InMemoryMenuItemRepository(), 60_000, {
      metrics: new MenuMetrics(meter),
    });

    await Promise.all([sut.findAll(), sut.findAll(), sut.findAll()]);
    await sut.findAll();

    expect(await sum('menu.cache.requests', { 'menu.cache.result': 'miss' })).toBe(1);
    expect(await sum('menu.cache.requests', { 'menu.cache.result': 'coalesced' })).toBe(2);
    expect(await sum('menu.cache.requests', { 'menu.cache.result': 'hit' })).toBe(1);
  });
});

describe('CachedMenuItemRepository (sincronização entre instâncias)', () => {
  const TTL = 60_000;
  const REFRESH_DELAY = 20;
  let database: InMemoryMenuItemRepository;
  let broker: InMemoryCacheInvalidationBroker;

  /** Uma "instância" da API: cache próprio, mesmo banco, mesmo barramento. */
  const createInstance = async (bus: CacheInvalidationBus = broker.createBus(), metrics = new MenuMetrics()) => {
    const cache = new CachedMenuItemRepository(database, TTL, {
      invalidationBus: bus,
      metrics,
      refreshDelayMs: REFRESH_DELAY,
    });
    await cache.listenForRemoteInvalidations();
    return cache;
  };

  beforeEach(() => {
    database = new InMemoryMenuItemRepository();
    broker = new InMemoryCacheInvalidationBroker();
  });

  it('a instância que escreveu também se atualiza logo em seguida, sem esperar o banco', async () => {
    const a = await createInstance();
    await a.findAll();

    await a.create(MenuItem.create({ name: 'Informática' }));

    expect(await a.findAll()).toHaveLength(0);
    await settle(REFRESH_DELAY + 10);
    expect(await a.findAll()).toHaveLength(1);
  });

  it('as outras instâncias servem a versão anterior e se atualizam logo em seguida', async () => {
    const a = await createInstance();
    const b = await createInstance();
    const c = await createInstance();
    await Promise.all([a.findAll(), b.findAll(), c.findAll()]);

    await a.create(MenuItem.create({ name: 'Informática' }));

    expect(await b.findAll()).toHaveLength(0);
    await settle(REFRESH_DELAY + 10);
    expect(await b.findAll()).toHaveLength(1);
    expect(await c.findAll()).toHaveLength(1);
  });

  it('agrupa uma rajada de avisos numa única recarga', async () => {
    const a = await createInstance();
    const b = await createInstance();
    await b.findAll();
    const spy = jest.spyOn(database, 'findAll');

    for (let i = 0; i < 10; i++) await a.create(MenuItem.create({ name: `Item ${i}` }));
    await settle(REFRESH_DELAY + 10);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(await b.findAll()).toHaveLength(10);
  });

  it('recarrega de novo se chegar um aviso durante a recarga', async () => {
    const a = await createInstance();
    const b = await createInstance();
    await b.findAll();
    const realFindAll = database.findAll.bind(database);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    jest.spyOn(database, 'findAll').mockImplementationOnce(async () => {
      const snapshot = await realFindAll();
      await gate;
      return snapshot;
    });

    await a.create(MenuItem.create({ name: 'Primeiro' }));
    await settle(REFRESH_DELAY + 10); // recarga de b começa e fica presa
    await a.create(MenuItem.create({ name: 'Segundo' }));
    release();
    await settle(REFRESH_DELAY + 20);

    expect(await b.findAll()).toHaveLength(2);
  });

  it('propaga exclusões', async () => {
    const a = await createInstance();
    const b = await createInstance();
    const item = MenuItem.create({ name: 'Informática' });
    await a.create(item);
    expect(await b.findAll()).toHaveLength(1);

    await a.deleteWithDescendants(item.id);
    await settle(REFRESH_DELAY + 10);

    expect(await b.findAll()).toHaveLength(0);
  });

  it('sem barramento, a outra instância só enxerga a escrita depois do TTL', async () => {
    const a = new CachedMenuItemRepository(database, TTL);
    const b = new CachedMenuItemRepository(database, TTL);
    await b.findAll();

    await a.create(MenuItem.create({ name: 'Informática' }));

    expect(await b.findAll()).toHaveLength(0);
  });

  it('registra invalidações locais e remotas, sem receber o próprio aviso', async () => {
    const metricsA = createTestMeter();
    const metricsB = createTestMeter();
    const a = await createInstance(broker.createBus(), new MenuMetrics(metricsA.meter));
    await createInstance(broker.createBus(), new MenuMetrics(metricsB.meter));

    await a.create(MenuItem.create({ name: 'Informática' }));

    const source = 'menu.cache.invalidation.source';
    expect(await metricsA.sum('menu.cache.invalidations', { [source]: 'local' })).toBe(1);
    expect(await metricsA.sum('menu.cache.invalidations', { [source]: 'remote' })).toBe(0);
    expect(await metricsB.sum('menu.cache.invalidations', { [source]: 'remote' })).toBe(1);
  });

  it('não falha a escrita quando o aviso não pode ser enviado', async () => {
    const failingBus: CacheInvalidationBus = {
      publish: () => Promise.reject(new Error('Redis fora do ar')),
      subscribe: async () => undefined,
      close: async () => undefined,
    };
    const { meter, sum } = createTestMeter();
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const a = await createInstance(failingBus, new MenuMetrics(meter));

    await expect(a.create(MenuItem.create({ name: 'Informática' }))).resolves.toBeUndefined();

    expect(await database.findAll()).toHaveLength(1);
    expect(await a.findAll()).toHaveLength(1);
    expect(await sum('menu.cache.invalidation.publish_failures')).toBe(1);
  });
});
