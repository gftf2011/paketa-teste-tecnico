import {
  InvalidMenuItemIdError,
  InvalidMenuItemNameError,
  MenuItemId,
  MenuItemNameAlreadyInUseError,
  ParentMenuItemNotFoundError,
} from '../../../domain';
import { InMemoryMenuItemRepository } from '../../../infra/database/in-memory/in-memory-menu-item-repository';
import { CreateMenuItemUseCase } from './create-menu-item.use-case';

describe('CreateMenuItemUseCase', () => {
  let repository: InMemoryMenuItemRepository;
  let sut: CreateMenuItemUseCase;

  beforeEach(() => {
    repository = new InMemoryMenuItemRepository();
    sut = new CreateMenuItemUseCase(repository);
  });

  it('cria um item raiz e retorna o id gerado', async () => {
    const { id } = await sut.execute({ name: 'Eletrodomésticos' });

    const saved = await repository.findById(MenuItemId.from(id));
    expect(saved?.name.value).toBe('Eletrodomésticos');
    expect(saved?.isRoot()).toBe(true);
  });

  it('cria um sub-item quando relatedId aponta para um item existente', async () => {
    const parent = await sut.execute({ name: 'Eletrodomésticos' });

    const { id } = await sut.execute({ name: 'Televisores', relatedId: parent.id });

    const saved = await repository.findById(MenuItemId.from(id));
    expect(saved?.parentId?.value).toBe(parent.id);
  });

  it('falha quando o item pai não existe', async () => {
    const relatedId = MenuItemId.generate().value;

    await expect(sut.execute({ name: 'Televisores', relatedId })).rejects.toThrow(
      ParentMenuItemNotFoundError,
    );
    expect(await repository.findAll()).toHaveLength(0);
  });

  it('falha quando o nome já está em uso', async () => {
    await sut.execute({ name: 'Informática' });

    await expect(sut.execute({ name: '  Informática ' })).rejects.toThrow(
      MenuItemNameAlreadyInUseError,
    );
    expect(await repository.findAll()).toHaveLength(1);
  });

  it('falha com nome inválido', async () => {
    await expect(sut.execute({ name: '' })).rejects.toThrow(InvalidMenuItemNameError);
  });

  it('falha com relatedId inválido', async () => {
    await expect(sut.execute({ name: 'Televisores', relatedId: 1 })).rejects.toThrow(
      InvalidMenuItemIdError,
    );
  });
});
