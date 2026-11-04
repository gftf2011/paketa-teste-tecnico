import {
  MenuItem,
  MenuItemId,
  MenuItemNameAlreadyInUseError,
  MenuItemRepository,
  ParentMenuItemNotFoundError,
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
  private readonly names = new Set<string>();

  async create(item: MenuItem): Promise<void> {
    if (item.parentId && !this.records.has(item.parentId.value)) {
      throw new ParentMenuItemNotFoundError(item.parentId.value);
    }
    if (this.names.has(item.name.value)) {
      throw new MenuItemNameAlreadyInUseError(item.name.value);
    }
    this.records.set(item.id.value, {
      id: item.id.value,
      name: item.name.value,
      parentId: item.parentId?.value ?? null,
    });
    this.names.add(item.name.value);
  }

  async findById(id: MenuItemId): Promise<MenuItem | null> {
    const record = this.records.get(id.value);
    return record ? MenuItem.restore(record) : null;
  }

  async findAll(): Promise<MenuItem[]> {
    return [...this.records.values()]
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .map((record) => MenuItem.restore(record));
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

    for (const recordId of toDelete) {
      this.names.delete(this.records.get(recordId)!.name);
      this.records.delete(recordId);
    }
    return toDelete.length;
  }
}
