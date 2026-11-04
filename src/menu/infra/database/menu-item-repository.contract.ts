import {
  MenuItem,
  MenuItemId,
  MenuItemNameAlreadyInUseError,
  MenuItemRepository,
  ParentMenuItemNotFoundError,
} from '../../domain';

/**
 * Suíte de contrato da porta MenuItemRepository. Toda implementação roda os
 * mesmos cenários, o que garante que o repositório em memória usado nos
 * testes se comporta igual ao MongoDB.
 */
export function describeMenuItemRepositoryContract(
  name: string,
  setup: () => { getRepository: () => MenuItemRepository },
): void {
  describe(`${name} (contrato MenuItemRepository)`, () => {
    const { getRepository } = setup();
    let sut: MenuItemRepository;

    const add = async (itemName: string, parent?: MenuItem) => {
      const item = MenuItem.create({ name: itemName, parentId: parent?.id.value });
      await sut.create(item);
      return item;
    };

    beforeEach(() => {
      sut = getRepository();
    });

    it('salva e recupera um item', async () => {
      const root = await add('Eletrodomésticos');
      const child = await add('Televisores', root);

      const found = await sut.findById(child.id);

      expect(found).not.toBe(child);
      expect(found?.id.equals(child.id)).toBe(true);
      expect(found?.name.value).toBe('Televisores');
      expect(found?.parentId?.equals(root.id)).toBe(true);
    });

    it('retorna null para id inexistente', async () => {
      expect(await sut.findById(MenuItemId.generate())).toBeNull();
    });

    it('rejeita item cujo pai não existe', async () => {
      const orphan = MenuItem.create({ name: 'Órfão', parentId: MenuItemId.generate().value });

      await expect(sut.create(orphan)).rejects.toThrow(ParentMenuItemNotFoundError);
      expect(await sut.findAll()).toHaveLength(0);
    });

    it('rejeita nome duplicado', async () => {
      await add('Informática');

      await expect(add('Informática')).rejects.toThrow(MenuItemNameAlreadyInUseError);
      expect(await sut.findAll()).toHaveLength(1);
    });

    it('garante nome único sob criações simultâneas', async () => {
      const results = await Promise.allSettled(
        Array.from({ length: 10 }, () => sut.create(MenuItem.create({ name: 'Informática' }))),
      );

      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(await sut.findAll()).toHaveLength(1);
    });

    it('lista todos os itens em ordem de criação', async () => {
      const a = await add('A');
      const b = await add('B', a);
      const c = await add('C');

      const all = await sut.findAll();

      expect(all.map((i) => i.id.value)).toEqual([a.id.value, b.id.value, c.id.value]);
    });

    it('exclui o item e todos os descendentes, preservando o resto', async () => {
      const root = await add('A');
      const child = await add('B', root);
      await add('C', child);
      await add('D', child);
      const other = await add('E');
      await add('F', other);

      expect(await sut.deleteWithDescendants(root.id)).toBe(4);
      expect((await sut.findAll()).map((i) => i.name.value)).toEqual(['E', 'F']);
    });

    it('libera o nome de itens excluídos', async () => {
      const item = await add('Informática');
      await sut.deleteWithDescendants(item.id);

      await expect(add('Informática')).resolves.toBeDefined();
    });

    it('retorna 0 ao excluir id inexistente', async () => {
      expect(await sut.deleteWithDescendants(MenuItemId.generate())).toBe(0);
    });
  });
}
