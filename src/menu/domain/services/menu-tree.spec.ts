import { MenuItem, MenuItemId, MenuTreeNode, buildMenuTree } from '..';

/** Remove os ids para comparar apenas a forma da árvore. */
const shape = (nodes: MenuTreeNode[]): unknown[] =>
  nodes.map((n) => ({ name: n.name, children: shape(n.children) }));

describe('buildMenuTree', () => {
  it('retorna lista vazia quando não há itens', () => {
    expect(buildMenuTree([])).toEqual([]);
  });

  it('monta o menu do exemplo do desafio', () => {
    const add = (name: string, parent?: MenuItem) =>
      MenuItem.create({ name, parentId: parent?.id.value });

    const eletro = add('Eletrodomésticos');
    const tv = add('Televisores', eletro);
    const lcd = add('LCD', tv);
    const v110 = add('110', lcd);
    const v220 = add('220', lcd);
    const plasma = add('Plasma', tv);
    const info = add('Informática');
    const pcs = add('Computadores', info);
    const apple = add('Apple', pcs);
    const macbook = add('MacBook', apple);
    const cabos = add('Cabos', macbook);
    const imac = add('iMac', apple);

    const items = [eletro, tv, lcd, v110, v220, plasma, info, pcs, apple, macbook, cabos, imac];
    const tree = buildMenuTree(items);

    expect(shape(tree)).toEqual([
      {
        name: 'Eletrodomésticos',
        children: [
          {
            name: 'Televisores',
            children: [
              {
                name: 'LCD',
                children: [
                  { name: '110', children: [] },
                  { name: '220', children: [] },
                ],
              },
              { name: 'Plasma', children: [] },
            ],
          },
        ],
      },
      {
        name: 'Informática',
        children: [
          {
            name: 'Computadores',
            children: [
              {
                name: 'Apple',
                children: [
                  { name: 'MacBook', children: [{ name: 'Cabos', children: [] }] },
                  { name: 'iMac', children: [] },
                ],
              },
            ],
          },
        ],
      },
    ]);
    expect(tree[0]?.id).toBe(eletro.id.value);
  });

  it('ordena irmãos pela criação, independente da ordem de entrada', () => {
    const first = MenuItem.create({ name: 'Primeiro' });
    const second = MenuItem.create({ name: 'Segundo' });
    const third = MenuItem.create({ name: 'Terceiro' });

    const tree = buildMenuTree([third, first, second]);

    expect(tree.map((n) => n.name)).toEqual(['Primeiro', 'Segundo', 'Terceiro']);
  });

  it('descarta itens órfãos junto com a subárvore deles', () => {
    const root = MenuItem.create({ name: 'Raiz' });
    const orphan = MenuItem.create({ name: 'Órfão', parentId: MenuItemId.generate().value });
    const orphanChild = MenuItem.create({ name: 'Filho do órfão', parentId: orphan.id.value });

    expect(shape(buildMenuTree([root, orphan, orphanChild]))).toEqual([
      { name: 'Raiz', children: [] },
    ]);
  });

  it('suporta aninhamento profundo sem estourar a pilha', () => {
    const depth = 20_000;
    const items: MenuItem[] = [MenuItem.create({ name: 'nível 0' })];
    for (let i = 1; i < depth; i++) {
      items.push(MenuItem.create({ name: `nível ${i}`, parentId: items[i - 1]!.id.value }));
    }

    const [root] = buildMenuTree(items);

    let levels = 0;
    for (let node = root; node; node = node.children[0]) levels++;
    expect(levels).toBe(depth);
  });
});
