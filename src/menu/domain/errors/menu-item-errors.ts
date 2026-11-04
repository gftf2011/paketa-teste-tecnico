import { ConflictError, NotFoundError, ValidationError } from '../../../shared/domain/domain-error';

export class InvalidMenuItemIdError extends ValidationError {
  readonly code = 'INVALID_MENU_ITEM_ID';

  constructor(value: unknown) {
    super(`"${String(value)}" não é um id de item de menu válido`);
  }
}

export class InvalidMenuItemNameError extends ValidationError {
  readonly code = 'INVALID_MENU_ITEM_NAME';
}

export class MenuItemNameAlreadyInUseError extends ConflictError {
  readonly code = 'MENU_ITEM_NAME_ALREADY_IN_USE';

  constructor(name: string) {
    super(`Já existe um item de menu com o nome "${name}"`);
  }
}

export class MenuItemNotFoundError extends NotFoundError {
  readonly code = 'MENU_ITEM_NOT_FOUND';

  constructor(id: string) {
    super(`Item de menu "${id}" não encontrado`);
  }
}

export class ParentMenuItemNotFoundError extends NotFoundError {
  readonly code = 'PARENT_MENU_ITEM_NOT_FOUND';

  constructor(id: string) {
    super(`Item de menu pai "${id}" não encontrado`);
  }
}
