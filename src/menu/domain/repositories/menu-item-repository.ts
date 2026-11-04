import { MenuItem } from '../aggregates/menu-item';
import { MenuItemId } from '../value-objects/menu-item-id';

/** Porta de persistência dos itens de menu, implementada pela infraestrutura. */
export interface MenuItemRepository {
  /**
   * Persiste um novo item. As regras de integridade são garantidas aqui, na
   * mesma operação de escrita, para valerem também sob criações simultâneas.
   * @throws ParentMenuItemNotFoundError se o item tiver pai e ele não existir.
   * @throws MenuItemNameAlreadyInUseError se o nome já estiver em uso.
   */
  create(item: MenuItem): Promise<void>;

  findById(id: MenuItemId): Promise<MenuItem | null>;

  /** Retorna todos os itens em ordem de criação. */
  findAll(): Promise<MenuItem[]>;

  /**
   * Remove o item e todos os seus descendentes.
   * @returns a quantidade de itens removidos (0 se o item não existir).
   */
  deleteWithDescendants(id: MenuItemId): Promise<number>;
}
