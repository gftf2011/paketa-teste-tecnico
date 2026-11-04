import { MenuTreeNode } from '../../domain';

export interface MenuItemResponse {
  id: string;
  name: string;
  submenus?: MenuItemResponse[];
}

/** Converte a árvore do domínio no formato da API: folhas não têm `submenus`. */
export const toMenuResponse = (nodes: readonly MenuTreeNode[]): MenuItemResponse[] =>
  nodes.map((node) =>
    node.children.length === 0
      ? { id: node.id, name: node.name }
      : { id: node.id, name: node.name, submenus: toMenuResponse(node.children) },
  );
