import { MenuItem } from '../aggregates/menu-item';

export interface MenuTreeNode {
  id: string;
  name: string;
  children: MenuTreeNode[];
}

/**
 * Monta a hierarquia do menu a partir da lista plana de itens.
 *
 * - Irmãos ficam em ordem de criação (o UUID v7 é ordenável pelo tempo).
 * - Itens cujo pai não está na lista são descartados com toda a sua
 *   subárvore, para nunca expor um galho solto.
 * - É iterativo (O(n log n) pela ordenação), então a profundidade do menu
 *   não esbarra no limite da pilha de chamadas.
 */
export function buildMenuTree(items: readonly MenuItem[]): MenuTreeNode[] {
  const sorted = [...items].sort(byCreation);

  const nodes = new Map<string, MenuTreeNode>();
  for (const item of sorted) {
    nodes.set(item.id.value, { id: item.id.value, name: item.name.value, children: [] });
  }

  const roots: MenuTreeNode[] = [];
  for (const item of sorted) {
    const node = nodes.get(item.id.value)!;
    if (item.parentId === null) {
      roots.push(node);
    } else {
      nodes.get(item.parentId.value)?.children.push(node);
    }
  }

  return roots;
}

const byCreation = (a: MenuItem, b: MenuItem): number =>
  a.id.value < b.id.value ? -1 : a.id.value > b.id.value ? 1 : 0;
