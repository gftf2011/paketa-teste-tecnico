import { MenuItem, MenuItemRepository, MenuTreeNode, buildMenuTree } from '../../../domain';
import { UseCase } from '../../../../shared/application/use-case';

export type GetMenuOutput = readonly MenuTreeNode[];

export class GetMenuUseCase implements UseCase<void, GetMenuOutput> {
  /**
   * Memoriza a árvore pela identidade da lista vinda do repositório: se ele
   * devolver a mesma lista (ex.: cacheada), a árvore não é remontada e o
   * mesmo objeto é devolvido, o que permite à camada HTTP reaproveitar a
   * resposta já serializada.
   */
  private readonly trees = new WeakMap<readonly MenuItem[], GetMenuOutput>();

  constructor(private readonly menuItemRepository: MenuItemRepository) {}

  async execute(): Promise<GetMenuOutput> {
    const items = await this.menuItemRepository.findAll();

    let tree = this.trees.get(items);
    if (!tree) {
      tree = buildMenuTree(items);
      this.trees.set(items, tree);
    }
    return tree;
  }
}
