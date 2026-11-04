import { describeMenuItemRepositoryContract } from '../menu-item-repository.contract';
import { InMemoryMenuItemRepository } from './in-memory-menu-item-repository';

describeMenuItemRepositoryContract('InMemoryMenuItemRepository', () => {
  let repository: InMemoryMenuItemRepository;

  beforeEach(() => {
    repository = new InMemoryMenuItemRepository();
  });

  return { getRepository: () => repository };
});
