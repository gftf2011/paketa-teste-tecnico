import { MenuItem, MenuItemRepository } from '../../../domain';
import { UseCase } from '../../../../shared/application/use-case';

export interface CreateMenuItemInput {
  name: unknown;
  relatedId?: unknown;
}

export interface CreateMenuItemOutput {
  id: string;
}

/**
 * Cria um item de menu. A existência do pai e a unicidade do nome são
 * garantidas pelo repositório na própria escrita: assim a criação custa
 * uma única ida ao banco e continua correta sob requisições simultâneas.
 */
export class CreateMenuItemUseCase implements UseCase<CreateMenuItemInput, CreateMenuItemOutput> {
  constructor(private readonly menuItemRepository: MenuItemRepository) {}

  async execute(input: CreateMenuItemInput): Promise<CreateMenuItemOutput> {
    const item = MenuItem.create({ name: input.name, parentId: input.relatedId });

    await this.menuItemRepository.create(item);

    return { id: item.id.value };
  }
}
