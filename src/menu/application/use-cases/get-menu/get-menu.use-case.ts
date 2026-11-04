import { MenuItemRepository, MenuTreeNode, buildMenuTree } from '../../../domain';
import { UseCase } from '../../../../shared/application/use-case';

export type GetMenuOutput = MenuTreeNode[];

export class GetMenuUseCase implements UseCase<void, GetMenuOutput> {
  constructor(private readonly menuItemRepository: MenuItemRepository) {}

  async execute(): Promise<GetMenuOutput> {
    return buildMenuTree(await this.menuItemRepository.findAll());
  }
}
