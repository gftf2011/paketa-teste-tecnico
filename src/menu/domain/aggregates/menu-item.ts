import { MenuItemId } from '../value-objects/menu-item-id';
import { MenuItemName } from '../value-objects/menu-item-name';

export interface CreateMenuItemProps {
  name: unknown;
  parentId?: unknown;
}

export interface RestoreMenuItemProps {
  id: string;
  name: string;
  parentId: string | null;
}

/**
 * Um item do menu. Cada item é independente e conhece apenas o seu pai
 * (`parentId`); itens sem pai são raízes. A hierarquia é derivada dessas
 * referências, o que permite aninhamento sem limite de profundidade.
 */
export class MenuItem {
  private constructor(
    readonly id: MenuItemId,
    readonly name: MenuItemName,
    readonly parentId: MenuItemId | null,
  ) {}

  /** Cria um novo item, gerando seu id e validando os dados de entrada. */
  static create(props: CreateMenuItemProps): MenuItem {
    const parentId = props.parentId == null ? null : MenuItemId.from(props.parentId);
    return new MenuItem(MenuItemId.generate(), MenuItemName.from(props.name), parentId);
  }

  /** Reconstrói um item já persistido. */
  static restore(props: RestoreMenuItemProps): MenuItem {
    return new MenuItem(
      MenuItemId.from(props.id),
      MenuItemName.from(props.name),
      props.parentId === null ? null : MenuItemId.from(props.parentId),
    );
  }

  isRoot(): boolean {
    return this.parentId === null;
  }
}
