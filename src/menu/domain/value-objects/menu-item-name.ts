import { InvalidMenuItemNameError } from '../errors/menu-item-errors';

/**
 * Nome de exibição de um item de menu.
 * Espaços nas pontas são removidos e espaços internos repetidos são
 * colapsados, para que "  Informática " e "Informática" sejam o mesmo nome.
 */
export class MenuItemName {
  static readonly MAX_LENGTH = 100;

  private constructor(readonly value: string) {}

  static from(value: unknown): MenuItemName {
    if (typeof value !== 'string') {
      throw new InvalidMenuItemNameError('O nome do item de menu deve ser um texto');
    }

    const normalized = value.trim().replace(/\s+/g, ' ');

    if (normalized.length === 0) {
      throw new InvalidMenuItemNameError('O nome do item de menu é obrigatório');
    }
    if (normalized.length > MenuItemName.MAX_LENGTH) {
      throw new InvalidMenuItemNameError(
        `O nome do item de menu deve ter no máximo ${MenuItemName.MAX_LENGTH} caracteres`,
      );
    }

    return new MenuItemName(normalized);
  }

  equals(other: MenuItemName): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }
}
