import {
  InvalidMenuItemIdError,
  MenuItem,
  MenuItemId,
  MenuItemNotFoundError,
} from '../../../domain';
import { InMemoryMenuItemRepository } from '../../../infra/database/in-memory/in-memory-menu-item-repository';
import { DeleteMenuItemUseCase } from './delete-menu-item.use-case';

describe('DeleteMenuItemUseCase', () => {
  let repository: InMemoryMenuItemRepository;
  let sut: DeleteMenuItemUseCase;

  const add = async (name: string, parent?: MenuItem) => {
    const item = MenuItem.create({ name, parentId: parent?.id.value });
    await repository.create(item);
    return item;
  };

  beforeEach(() => {
    repository = new InMemoryMenuItemRepository();
    sut = new DeleteMenuItemUseCase(repository);
  });

  it('exclui um item sem sub-itens', async () => {
    const item = await add('Informática');

    const result = await sut.execute({ id: item.id.value });

    expect(result.deletedCount).toBe(1);
    expect(await repository.findAll()).toHaveLength(0);
  });

  it('exclui o item e toda a sua subárvore, preservando o resto do menu', async () => {
    const eletro = await add('Eletrodomésticos');
    const tv = await add('Televisores', eletro);
    const lcd = await add('LCD', tv);
    await add('110', lcd);
    await add('Plasma', tv);
    const info = await add('Informática');
    await add('Computadores', info);

    const result = await sut.execute({ id: tv.id.value });

    expect(result.deletedCount).toBe(4);
    const remaining = (await repository.findAll()).map((i) => i.name.value).sort();
    expect(remaining).toEqual(['Computadores', 'Eletrodomésticos', 'Informática']);
  });

  it('falha quando o item não existe', async () => {
    await expect(sut.execute({ id: MenuItemId.generate().value })).rejects.toThrow(
      MenuItemNotFoundError,
    );
  });

  it('falha com id inválido', async () => {
    await expect(sut.execute({ id: 'abc' })).rejects.toThrow(InvalidMenuItemIdError);
  });
});
