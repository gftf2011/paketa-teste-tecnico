import { MenuItemId, MenuItemNotFoundError, MenuItemRepository } from '../../../domain';
import { UseCase } from '../../../../shared/application/use-case';

export interface DeleteMenuItemInput {
  id: unknown;
}

export interface DeleteMenuItemOutput {
  deletedCount: number;
}

/** Exclui o item e, em cascata, todos os seus sub-itens. */
export class DeleteMenuItemUseCase implements UseCase<DeleteMenuItemInput, DeleteMenuItemOutput> {
  constructor(private readonly menuItemRepository: MenuItemRepository) {}

  async execute(input: DeleteMenuItemInput): Promise<DeleteMenuItemOutput> {
    const id = MenuItemId.from(input.id);

    const deletedCount = await this.menuItemRepository.deleteWithDescendants(id);
    if (deletedCount === 0) {
      throw new MenuItemNotFoundError(id.value);
    }

    return { deletedCount };
  }
}
