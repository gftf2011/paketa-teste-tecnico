import { MenuItem } from '../../../domain';
import { InMemoryMenuItemRepository } from '../../../infra/database/in-memory/in-memory-menu-item-repository';
import { GetMenuUseCase } from './get-menu.use-case';

describe('GetMenuUseCase', () => {
  let repository: InMemoryMenuItemRepository;
  let sut: GetMenuUseCase;

  beforeEach(() => {
    repository = new InMemoryMenuItemRepository();
    sut = new GetMenuUseCase(repository);
  });

  it('retorna lista vazia quando não há itens', async () => {
    expect(await sut.execute()).toEqual([]);
  });

  it('retorna o menu completo de forma hierárquica', async () => {
    const eletro = MenuItem.create({ name: 'Eletrodomésticos' });
    const tv = MenuItem.create({ name: 'Televisores', parentId: eletro.id.value });
    const info = MenuItem.create({ name: 'Informática' });
    for (const item of [eletro, tv, info]) await repository.create(item);

    expect(await sut.execute()).toEqual([
      {
        id: eletro.id.value,
        name: 'Eletrodomésticos',
        children: [{ id: tv.id.value, name: 'Televisores', children: [] }],
      },
      { id: info.id.value, name: 'Informática', children: [] },
    ]);
  });
});
