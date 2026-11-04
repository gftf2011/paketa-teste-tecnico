import { MenuItem } from '../aggregates/menu-item';
import { MenuItemId } from '../value-objects/menu-item-id';
import { MenuItemName } from '../value-objects/menu-item-name';

/** Porta de persistência dos itens de menu, implementada pela infraestrutura. */
export interface MenuItemRepository {
  /**
   * Persiste um novo item.
   * @throws MenuItemNameAlreadyInUseError se o nome já estiver em uso,
   *   inclusive quando outro item com o mesmo nome for salvo ao mesmo tempo.
   */
  create(item: MenuItem): Promise<void>;

  findById(id: MenuItemId): Promise<MenuItem | null>;

  existsByName(name: MenuItemName): Promise<boolean>;

  findAll(): Promise<MenuItem[]>;

  /**
   * Remove o item e todos os seus descendentes.
   * @returns a quantidade de itens removidos (0 se o item não existir).
   */
  deleteWithDescendants(id: MenuItemId): Promise<number>;
}
