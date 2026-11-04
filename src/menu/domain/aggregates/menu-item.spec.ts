import {
  InvalidMenuItemIdError,
  InvalidMenuItemNameError,
  MenuItem,
  MenuItemId,
} from '..';

describe('MenuItem', () => {
  describe('create', () => {
    it('cria um item raiz quando não há pai', () => {
      const item = MenuItem.create({ name: 'Eletrodomésticos' });

      expect(item.id).toBeInstanceOf(MenuItemId);
      expect(item.name.value).toBe('Eletrodomésticos');
      expect(item.parentId).toBeNull();
      expect(item.isRoot()).toBe(true);
    });

    it('trata parentId null como item raiz', () => {
      expect(MenuItem.create({ name: 'Informática', parentId: null }).isRoot()).toBe(true);
    });

    it('cria um sub-item vinculado ao pai', () => {
      const parent = MenuItem.create({ name: 'Eletrodomésticos' });
      const child = MenuItem.create({ name: 'Televisores', parentId: parent.id.value });

      expect(child.parentId?.equals(parent.id)).toBe(true);
      expect(child.isRoot()).toBe(false);
    });

    it('gera um id diferente a cada item', () => {
      const a = MenuItem.create({ name: 'A' });
      const b = MenuItem.create({ name: 'B' });

      expect(a.id.equals(b.id)).toBe(false);
    });

    it('rejeita nome inválido', () => {
      expect(() => MenuItem.create({ name: '' })).toThrow(InvalidMenuItemNameError);
    });

    it('rejeita parentId inválido', () => {
      expect(() => MenuItem.create({ name: 'Televisores', parentId: 1 })).toThrow(
        InvalidMenuItemIdError,
      );
    });
  });

  describe('restore', () => {
    it('reconstrói um item persistido sem gerar novo id', () => {
      const parentId = MenuItemId.generate().value;
      const id = MenuItemId.generate().value;

      const item = MenuItem.restore({ id, name: 'Televisores', parentId });

      expect(item.id.value).toBe(id);
      expect(item.name.value).toBe('Televisores');
      expect(item.parentId?.value).toBe(parentId);
    });
  });
});
