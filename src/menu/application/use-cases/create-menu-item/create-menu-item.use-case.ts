import {
  MenuItem,
  MenuItemNameAlreadyInUseError,
  MenuItemRepository,
  ParentMenuItemNotFoundError,
} from '../../../domain';
import { UseCase } from '../../../../shared/application/use-case';

export interface CreateMenuItemInput {
  name: unknown;
  relatedId?: unknown;
}

export interface CreateMenuItemOutput {
  id: string;
}

export class CreateMenuItemUseCase implements UseCase<CreateMenuItemInput, CreateMenuItemOutput> {
  constructor(private readonly menuItemRepository: MenuItemRepository) {}

  async execute(input: CreateMenuItemInput): Promise<CreateMenuItemOutput> {
    const item = MenuItem.create({ name: input.name, parentId: input.relatedId });

    if (item.parentId && !(await this.menuItemRepository.findById(item.parentId))) {
      throw new ParentMenuItemNotFoundError(item.parentId.value);
    }

    // Verificação antecipada para uma resposta clara; o repositório ainda
    // garante a unicidade em caso de criações simultâneas.
    if (await this.menuItemRepository.existsByName(item.name)) {
      throw new MenuItemNameAlreadyInUseError(item.name.value);
    }

    await this.menuItemRepository.create(item);

    return { id: item.id.value };
  }
}
