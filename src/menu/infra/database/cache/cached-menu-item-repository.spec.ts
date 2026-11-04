import { MenuItem } from '../../../domain';
import { InMemoryMenuItemRepository } from '../in-memory/in-memory-menu-item-repository';
import { describeMenuItemRepositoryContract } from '../menu-item-repository.contract';
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

describe('CachedMenuItemRepository (cache)', () => {
  const TTL = 1_000;
  let inner: InMemoryMenuItemRepository;
  let clock: number;
  let sut: CachedMenuItemRepository;

  beforeEach(() => {
    inner = new InMemoryMenuItemRepository();
    clock = 0;
    sut = new CachedMenuItemRepository(inner, TTL, { now: () => clock });
  });

  it('serve leituras seguintes do cache dentro do TTL', async () => {
    const spy = jest.spyOn(inner, 'findAll');

    await sut.findAll();
    clock += TTL - 1;
    await sut.findAll();

    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('volta ao banco depois que o TTL expira', async () => {
    const spy = jest.spyOn(inner, 'findAll');

    await sut.findAll();
    clock += TTL;
    await sut.findAll();

    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('enxerga escritas feitas por outra instância depois do TTL', async () => {
    await sut.findAll();
    await inner.create(MenuItem.create({ name: 'Criado por outra instância' }));

    expect(await sut.findAll()).toHaveLength(0);
    clock += TTL;
    expect(await sut.findAll()).toHaveLength(1);
  });

  it('compartilha uma única consulta entre leituras simultâneas', async () => {
    const spy = jest.spyOn(inner, 'findAll');

    await Promise.all(Array.from({ length: 50 }, () => sut.findAll()));

    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('invalida o cache ao criar um item', async () => {
    await sut.findAll();
    await sut.create(MenuItem.create({ name: 'Informática' }));

    expect(await sut.findAll()).toHaveLength(1);
  });

  it('invalida o cache ao excluir um item', async () => {
    const item = MenuItem.create({ name: 'Informática' });
    await sut.create(item);
    await sut.findAll();

    await sut.deleteWithDescendants(item.id);

    expect(await sut.findAll()).toHaveLength(0);
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
