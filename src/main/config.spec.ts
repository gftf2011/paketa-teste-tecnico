import { loadConfig } from './config';

describe('loadConfig', () => {
  it('usa valores padrão quando nada é informado', () => {
    expect(loadConfig({})).toEqual({
      port: 3000,
      mongo: { url: 'mongodb://localhost:27017', dbName: 'menu', maxPoolSize: 50 },
      menuCacheTtlMs: 5000,
      menuCacheRefreshDelayMs: 50,
      redisUrl: undefined,
    });
  });

  it('lê as variáveis de ambiente', () => {
    const config = loadConfig({
      PORT: '8080',
      MONGO_URL: 'mongodb://mongo:27017',
      MONGO_DB_NAME: 'menus',
      MONGO_MAX_POOL_SIZE: '100',
      MENU_CACHE_TTL_MS: '0',
      MENU_CACHE_REFRESH_DELAY_MS: '100',
      REDIS_URL: 'redis://redis:6379',
    });

    expect(config).toEqual({
      port: 8080,
      mongo: { url: 'mongodb://mongo:27017', dbName: 'menus', maxPoolSize: 100 },
      menuCacheTtlMs: 0,
      menuCacheRefreshDelayMs: 100,
      redisUrl: 'redis://redis:6379',
    });
  });

  it.each(['abc', '-1', '1.5'])('rejeita número inválido %p', (value) => {
    expect(() => loadConfig({ PORT: value })).toThrow('PORT');
  });
});
