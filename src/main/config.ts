export interface Config {
  port: number;
  mongo: {
    url: string;
    dbName: string;
    maxPoolSize: number;
  };
  /** Tempo máximo que o menu fica em cache; 0 desliga o cache. */
  menuCacheTtlMs: number;
  /** Janela para agrupar avisos de outras instâncias numa única recarga. */
  menuCacheRefreshDelayMs: number;
  /**
   * Redis usado para sincronizar o cache entre instâncias (Pub/Sub).
   * Ausente: cada instância depende só do TTL.
   */
  redisUrl?: string;
}

const readInt = (env: NodeJS.ProcessEnv, key: string, fallback: number): number => {
  const raw = env[key];
  if (raw === undefined || raw === '') return fallback;

  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`Variável de ambiente ${key} inválida: "${raw}"`);
  }
  return value;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    port: readInt(env, 'PORT', 3000),
    mongo: {
      url: env.MONGO_URL || 'mongodb://localhost:27017',
      dbName: env.MONGO_DB_NAME || 'menu',
      maxPoolSize: readInt(env, 'MONGO_MAX_POOL_SIZE', 50),
    },
    menuCacheTtlMs: readInt(env, 'MENU_CACHE_TTL_MS', 5_000),
    menuCacheRefreshDelayMs: readInt(env, 'MENU_CACHE_REFRESH_DELAY_MS', 50),
    redisUrl: env.REDIS_URL || undefined,
  };
}
