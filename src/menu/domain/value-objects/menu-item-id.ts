import { v7 as uuidv7, validate as isUuid } from 'uuid';
import { InvalidMenuItemIdError } from '../errors/menu-item-errors';

/**
 * Identificador de um item de menu: UUID v7.
 * Gerado no próprio domínio (sem depender do banco), não colide entre
 * instâncias da aplicação e é ordenável pelo momento de criação.
 */
export class MenuItemId {
  private constructor(readonly value: string) {}

  static generate(): MenuItemId {
    return new MenuItemId(uuidv7());
  }

  static from(value: unknown): MenuItemId {
    if (typeof value !== 'string' || !isUuid(value)) {
      throw new InvalidMenuItemIdError(value);
    }
    return new MenuItemId(value.toLowerCase());
  }

  equals(other: MenuItemId): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }
}
