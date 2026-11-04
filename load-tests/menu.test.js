/**
 * Teste de carga da API de menu com k6.
 *
 * Simula o uso real de um menu: muitas leituras (navegadores carregando a
 * página, metade revalidando com ETag) e poucas escritas (administração
 * criando e removendo itens).
 *
 * Variáveis:
 *   TEST_TYPE   smoke | load | stress | spike  (padrão: smoke)
 *   BASE_URL    URL da API                    (padrão: http://localhost:3000)
 *   SEED_ITEMS  itens criados antes do teste  (padrão: 500)
 */
import http from 'k6/http';
import { check, fail } from 'k6';
import { Rate } from 'k6/metrics';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const MENU_URL = `${BASE_URL}/api/v1/menu`;
const TEST_TYPE = __ENV.TEST_TYPE || 'smoke';
const SEED_ITEMS = Number(__ENV.SEED_ITEMS || 500);
const JSON_HEADERS = { 'Content-Type': 'application/json' };

/** Fração das leituras respondidas com 304 (cliente já tinha a versão atual). */
const notModifiedRate = new Rate('menu_not_modified');

// Leituras usam taxa de chegada (modelo aberto): a carga não diminui quando
// a API fica lenta, como acontece com usuários reais.
// VUs pré-alocados evitam que o k6 descarte iterações enquanto cria VUs
// novos durante rampas rápidas.
const readers = (stages, { startRate = 0, preAllocatedVUs = 50 } = {}) => ({
  executor: 'ramping-arrival-rate',
  exec: 'readMenu',
  startRate,
  timeUnit: '1s',
  preAllocatedVUs,
  maxVUs: 1000,
  stages,
});

const writers = (rate, duration) => ({
  executor: 'constant-arrival-rate',
  exec: 'writeMenu',
  rate,
  timeUnit: '1s',
  duration,
  preAllocatedVUs: 5,
  maxVUs: 50,
});

const PROFILES = {
  // Sanidade: carga mínima, valida que tudo responde corretamente.
  smoke: {
    scenarios: {
      readers: readers([{ target: 10, duration: '30s' }], { startRate: 10 }),
      writers: writers(1, '30s'),
    },
    p95ReadMs: 100,
    p95WriteMs: 200,
  },
  // Carga esperada em produção, sustentada.
  load: {
    scenarios: {
      readers: readers([
        { target: 500, duration: '30s' },
        { target: 500, duration: '2m' },
        { target: 0, duration: '15s' },
      ]),
      writers: writers(5, '2m45s'),
    },
    p95ReadMs: 100,
    p95WriteMs: 200,
  },
  // Acima do esperado, para achar o limite.
  stress: {
    scenarios: {
      readers: readers([
        { target: 1000, duration: '30s' },
        { target: 2000, duration: '1m' },
        { target: 3000, duration: '1m' },
        { target: 0, duration: '15s' },
      ], { preAllocatedVUs: 300 }),
      writers: writers(10, '2m45s'),
    },
    p95ReadMs: 500,
    p95WriteMs: 1000,
  },
  // Pico repentino de acessos, como o lançamento de uma campanha.
  spike: {
    scenarios: {
      readers: readers(
        [
          { target: 50, duration: '20s' },
          { target: 3000, duration: '10s' },
          { target: 3000, duration: '30s' },
          { target: 50, duration: '10s' },
          { target: 50, duration: '20s' },
        ],
        { startRate: 50, preAllocatedVUs: 300 },
      ),
      writers: writers(2, '1m30s'),
    },
    p95ReadMs: 500,
    p95WriteMs: 1000,
  },
};

const profile = PROFILES[TEST_TYPE];
if (!profile) {
  throw new Error(`TEST_TYPE inválido: "${TEST_TYPE}". Use: ${Object.keys(PROFILES).join(', ')}`);
}

export const options = {
  scenarios: profile.scenarios,
  thresholds: {
    http_req_failed: ['rate<0.01'],
    checks: ['rate>0.99'],
    'http_req_duration{scenario:readers}': [`p(95)<${profile.p95ReadMs}`],
    'http_req_duration{scenario:writers}': [`p(95)<${profile.p95WriteMs}`],
  },
  summaryTrendStats: ['avg', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
};

/** Nome único por execução, para não colidir com dados existentes. */
const RUN_ID = `k6-${Date.now().toString(36)}`;

const createItem = (name, relatedId, params = {}) =>
  http.post(MENU_URL, JSON.stringify({ name, relatedId }), {
    headers: JSON_HEADERS,
    tags: { name: 'POST /api/v1/menu' },
    ...params,
  });

const deleteItem = (id) => http.del(`${MENU_URL}/${id}`, null, { tags: { name: 'DELETE /api/v1/menu/:id' } });

/**
 * Popula o menu com SEED_ITEMS itens em árvore (10 raízes, 5 filhos por
 * item), nível a nível, com as criações de cada nível em paralelo.
 */
export function setup() {
  const health = http.get(`${BASE_URL}/health`);
  if (health.status !== 200) fail(`API indisponível em ${BASE_URL} (status ${health.status})`);

  const roots = [];
  let parents = [null];
  let created = 0;

  while (created < SEED_ITEMS) {
    const requests = [];
    for (const parent of parents) {
      const children = parent === null ? 10 : 5;
      for (let i = 0; i < children && created + requests.length < SEED_ITEMS; i++) {
        const name = `${RUN_ID}-seed-${created + requests.length}`;
        requests.push(['POST', MENU_URL, JSON.stringify({ name, relatedId: parent }), { headers: JSON_HEADERS }]);
      }
    }
    if (requests.length === 0) break;

    const ids = http.batch(requests).map((res) => {
      if (res.status !== 201) fail(`Falha ao popular o menu: ${res.status} ${res.body}`);
      return res.json('id');
    });
    if (parents[0] === null) roots.push(...ids);

    created += ids.length;
    parents = ids;
  }

  console.log(`Menu populado com ${created} itens (${roots.length} raízes)`);
  return { roots };
}

/** Por VU: último ETag recebido, como o cache de um navegador. */
let etag = null;

export function readMenu() {
  // Metade das leituras simula um navegador que já tem o menu em cache.
  const revalidate = etag !== null && Math.random() < 0.5;
  const res = http.get(MENU_URL, {
    headers: revalidate ? { 'If-None-Match': etag } : {},
    tags: { name: 'GET /api/v1/menu' },
  });

  const ok = check(res, {
    'GET menu: 200 ou 304': (r) => r.status === 200 || r.status === 304,
    'GET menu: 200 traz uma lista': (r) => r.status !== 200 || Array.isArray(r.json()),
  });

  if (ok && res.headers.Etag) etag = res.headers.Etag;
  if (revalidate) notModifiedRate.add(res.status === 304);
}

export function writeMenu() {
  const prefix = `${RUN_ID}-w${__VU}-${__ITER}`;

  const root = createItem(`${prefix}-root`);
  check(root, { 'POST raiz: 201': (r) => r.status === 201 });
  if (root.status !== 201) return;

  const child = createItem(`${prefix}-child`, root.json('id'));
  check(child, { 'POST filho: 201': (r) => r.status === 201 });

  // 409 aqui é o esperado: não deve contar como falha em http_req_failed.
  const duplicate = createItem(`${prefix}-child`, root.json('id'), {
    responseCallback: http.expectedStatuses(409),
  });
  check(duplicate, { 'POST duplicado: 409': (r) => r.status === 409 });

  const removed = deleteItem(root.json('id'));
  check(removed, {
    'DELETE em cascata: 200': (r) => r.status === 200,
    'DELETE em cascata: remove 2 itens': (r) => r.status === 200 && r.json('deletedCount') === 2,
  });
}

/** Remove o menu criado no setup, deixando o banco como estava. */
export function teardown({ roots }) {
  for (const id of roots) deleteItem(id);
}
