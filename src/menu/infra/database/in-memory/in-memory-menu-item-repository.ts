import {
  MenuItem,
  MenuItemId,
  MenuItemName,
  MenuItemNameAlreadyInUseError,
  MenuItemRepository,
} from '../../../domain';

interface MenuItemRecord {
  id: string;
  name: string;
  parentId: string | null;
}

/**
 * Implementação em memória do repositório. Útil em testes e para rodar a
 * aplicação sem banco. Guarda dados primitivos, como um banco faria, para
 * que nenhuma instância de domínio seja compartilhada entre leituras.
 */
export class InMemoryMenuItemRepository implements MenuItemRepository {
  private readonly records = new Map<string, MenuItemRecord>();

  async create(item: MenuItem): Promise<void> {
    if (await this.existsByName(item.name)) {
      throw new MenuItemNameAlreadyInUseError(item.name.value);
    }
    this.records.set(item.id.value, {
      id: item.id.value,
      name: item.name.value,
      parentId: item.parentId?.value ?? null,
    });
  }

  async findById(id: MenuItemId): Promise<MenuItem | null> {
    const record = this.records.get(id.value);
    return record ? MenuItem.restore(record) : null;
  }

  async existsByName(name: MenuItemName): Promise<boolean> {
    return [...this.records.values()].some((record) => record.name === name.value);
  }

  async findAll(): Promise<MenuItem[]> {
    return [...this.records.values()].map((record) => MenuItem.restore(record));
  }

  async deleteWithDescendants(id: MenuItemId): Promise<number> {
    if (!this.records.has(id.value)) return 0;

    const childrenByParent = new Map<string, string[]>();
    for (const record of this.records.values()) {
      if (record.parentId === null) continue;
      const siblings = childrenByParent.get(record.parentId) ?? [];
      siblings.push(record.id);
      childrenByParent.set(record.parentId, siblings);
    }

    const toDelete = [id.value];
    for (let i = 0; i < toDelete.length; i++) {
      toDelete.push(...(childrenByParent.get(toDelete[i]!) ?? []));
    }

    for (const recordId of toDelete) this.records.delete(recordId);
    return toDelete.length;
  }
}
