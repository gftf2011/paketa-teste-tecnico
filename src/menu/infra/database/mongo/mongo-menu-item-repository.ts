import { Collection, Db, MongoServerError } from 'mongodb';
import {
  MenuItem,
  MenuItemId,
  MenuItemNameAlreadyInUseError,
  MenuItemRepository,
  ParentMenuItemNotFoundError,
} from '../../../domain';

/**
 * Documento persistido. Além do pai, guarda a lista de ancestrais
 * (padrão "Array of Ancestors"): itens nunca mudam de pai, então a lista é
 * imutável e permite apagar uma subárvore inteira com uma única consulta
 * indexada, sem percorrer a árvore nível a nível.
 */
interface MenuItemDocument {
  _id: string;
  name: string;
  parentId: string | null;
  ancestors: string[];
}

const DUPLICATE_KEY = 11000;

export class MongoMenuItemRepository implements MenuItemRepository {
  static readonly COLLECTION = 'menu_items';

  private readonly collection: Collection<MenuItemDocument>;

  constructor(db: Db) {
    this.collection = db.collection<MenuItemDocument>(MongoMenuItemRepository.COLLECTION);
  }

  /** Cria os índices (idempotente). Deve rodar na inicialização da aplicação. */
  async ensureIndexes(): Promise<void> {
    await this.collection.createIndexes([
      { key: { name: 1 }, name: 'uniq_name', unique: true },
      { key: { ancestors: 1 }, name: 'idx_ancestors' },
    ]);
  }

  async create(item: MenuItem): Promise<void> {
    let ancestors: string[] = [];

    if (item.parentId) {
      const parent = await this.collection.findOne(
        { _id: item.parentId.value },
        { projection: { ancestors: 1 } },
      );
      if (!parent) throw new ParentMenuItemNotFoundError(item.parentId.value);
      ancestors = [...parent.ancestors, parent._id];
    }

    try {
      await this.collection.insertOne({
        _id: item.id.value,
        name: item.name.value,
        parentId: item.parentId?.value ?? null,
        ancestors,
      });
    } catch (error) {
      if (error instanceof MongoServerError && error.code === DUPLICATE_KEY && error.keyPattern?.name) {
        throw new MenuItemNameAlreadyInUseError(item.name.value);
      }
      throw error;
    }
  }

  async findById(id: MenuItemId): Promise<MenuItem | null> {
    const doc = await this.collection.findOne(
      { _id: id.value },
      { projection: { name: 1, parentId: 1 } },
    );
    return doc ? toDomain(doc) : null;
  }

  async findAll(): Promise<MenuItem[]> {
    // Projeção sem `ancestors` para não trafegar dados que a leitura não usa;
    // a ordenação usa o índice de _id (UUID v7 = ordem de criação).
    const docs = await this.collection
      .find({}, { projection: { name: 1, parentId: 1 } })
      .sort({ _id: 1 })
      .toArray();
    return docs.map(toDomain);
  }

  async deleteWithDescendants(id: MenuItemId): Promise<number> {
    const { deletedCount } = await this.collection.deleteMany({
      $or: [{ _id: id.value }, { ancestors: id.value }],
    });
    return deletedCount;
  }
}

const toDomain = (doc: Pick<MenuItemDocument, '_id' | 'name' | 'parentId'>): MenuItem =>
  MenuItem.restore({ id: doc._id, name: doc.name, parentId: doc.parentId });
