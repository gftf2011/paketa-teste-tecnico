import { MongoClient } from 'mongodb';
import { MenuItemRepository } from '../menu/domain';
import { CachedMenuItemRepository } from '../menu/infra/database/cache/cached-menu-item-repository';
import { MongoMenuItemRepository } from '../menu/infra/database/mongo/mongo-menu-item-repository';
import { createApp } from './app';
import { loadConfig } from './config';

async function bootstrap(): Promise<void> {
  const config = loadConfig();

  const mongoClient = new MongoClient(config.mongo.url, {
    maxPoolSize: config.mongo.maxPoolSize,
  });
  await mongoClient.connect();

  const mongoRepository = new MongoMenuItemRepository(mongoClient.db(config.mongo.dbName));
  await mongoRepository.ensureIndexes();

  const menuItemRepository: MenuItemRepository =
    config.menuCacheTtlMs > 0
      ? new CachedMenuItemRepository(mongoRepository, config.menuCacheTtlMs)
      : mongoRepository;

  const server = createApp({ menuItemRepository }).listen(config.port, () => {
    console.log(`API de menu ouvindo na porta ${config.port}`);
  });
  // Mantém conexões keep-alive abertas por mais tempo que o load balancer.
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 66_000;

  const shutdown = (signal: string) => {
    console.log(`${signal} recebido, encerrando...`);
    server.close(async () => {
      await mongoClient.close();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT', () => shutdown('SIGINT'));
}

bootstrap().catch((error) => {
  console.error('Falha ao iniciar a aplicação', error);
  process.exit(1);
});
