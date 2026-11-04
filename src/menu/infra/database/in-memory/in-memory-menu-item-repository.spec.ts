import { MenuItem, MenuItemId, MenuItemName, MenuItemNameAlreadyInUseError } from '../../../domain';
import { InMemoryMenuItemRepository } from './in-memory-menu-item-repository';

describe('InMemoryMenuItemRepository', () => {
  let sut: InMemoryMenuItemRepository;

  beforeEach(() => {
    sut = new InMemoryMenuItemRepository();
  });

  it('salva e recupera um item', async () => {
    const item = MenuItem.create({ name: 'Informática' });
    await sut.create(item);

    const found = await sut.findById(item.id);

    expect(found).not.toBe(item);
    expect(found?.id.equals(item.id)).toBe(true);
    expect(found?.name.value).toBe('Informática');
  });

  it('retorna null para id inexistente', async () => {
    expect(await sut.findById(MenuItemId.generate())).toBeNull();
  });

  it('informa se um nome já existe', async () => {
    await sut.create(MenuItem.create({ name: 'Informática' }));

    expect(await sut.existsByName(MenuItemName.from('Informática'))).toBe(true);
    expect(await sut.existsByName(MenuItemName.from('Eletrodomésticos'))).toBe(false);
  });

  it('rejeita nome duplicado ao criar', async () => {
    await sut.create(MenuItem.create({ name: 'Informática' }));

    await expect(sut.create(MenuItem.create({ name: 'Informática' }))).rejects.toThrow(
      MenuItemNameAlreadyInUseError,
    );
  });

  it('exclui em cascata e retorna 0 para id inexistente', async () => {
    const root = MenuItem.create({ name: 'A' });
    const child = MenuItem.create({ name: 'B', parentId: root.id.value });
    const grandchild = MenuItem.create({ name: 'C', parentId: child.id.value });
    const other = MenuItem.create({ name: 'D' });
    for (const item of [root, child, grandchild, other]) await sut.create(item);

    expect(await sut.deleteWithDescendants(root.id)).toBe(3);
    expect((await sut.findAll()).map((i) => i.name.value)).toEqual(['D']);
    expect(await sut.deleteWithDescendants(root.id)).toBe(0);
  });
});
