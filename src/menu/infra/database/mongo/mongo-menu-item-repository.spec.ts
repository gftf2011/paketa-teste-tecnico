import { MongoClient } from 'mongodb';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { describeMenuItemRepositoryContract } from '../menu-item-repository.contract';
import { MongoMenuItemRepository } from './mongo-menu-item-repository';

jest.setTimeout(60_000);

describeMenuItemRepositoryContract('MongoMenuItemRepository', () => {
  let server: MongoMemoryServer;
  let client: MongoClient;
  let repository: MongoMenuItemRepository;

  beforeAll(async () => {
    server = await MongoMemoryServer.create();
    client = await MongoClient.connect(server.getUri());
    repository = new MongoMenuItemRepository(client.db('menu-test'));
    await repository.ensureIndexes();
  });

  beforeEach(async () => {
    await client.db('menu-test').collection(MongoMenuItemRepository.COLLECTION).deleteMany({});
  });

  afterAll(async () => {
    await client?.close();
    await server?.stop();
  });

  return { getRepository: () => repository };
});
