# API de Menu

Serviço para gestão do menu de um site corporativo. O menu é formado por itens e sub-itens, com **aninhamento infinito**: cada item é um registro independente no banco que aponta para o seu pai, e a API devolve a árvore completa.

**Stack:** Node.js 24, TypeScript, Express 5 e MongoDB 7.

## Sumário

- [Como rodar](#como-rodar)
- [Endpoints](#endpoints)
- [Arquitetura](#arquitetura)
- [Decisões técnicas](#decisões-técnicas)
- [Desempenho e escala](#desempenho-e-escala)
- [Diferenças em relação ao enunciado](#diferenças-em-relação-ao-enunciado)

## Como rodar

### Com Docker (recomendado)

Requer apenas Docker.

```bash
npm run docker:up
```

O comando constrói a imagem e sobe a API e o MongoDB, terminando quando os dois estão saudáveis. A API fica em `http://localhost:3000`.

| Comando | O que faz |
|---|---|
| `npm run docker:up` | Constrói e sobe a API e o MongoDB |
| `npm run docker:down` | Para os containers (os dados ficam no volume) |
| `npm run docker:logs` | Acompanha os logs da API |

As portas publicadas podem ser trocadas com `API_PORT` e `MONGO_PORT` (ex.: `API_PORT=8080 npm run docker:up`).

### Localmente

Requer Node.js 20+ e Docker (só para o MongoDB).

```bash
npm install
npm run dev:docker
```

O MongoDB sobe no Docker e a API roda localmente, recarregando a cada alteração. Para usar outro MongoDB, defina `MONGO_URL` e rode `npm run dev`.

Não rode `dev:docker` junto com `docker:up`: os dois usam a porta 3000.

### Testes

```bash
npm test
npm run typecheck
```

Os testes do repositório MongoDB usam o [mongodb-memory-server](https://github.com/typegoose/mongodb-memory-server), que baixa o binário do MongoDB na primeira execução. Não é preciso ter um banco rodando.

### Testes de carga (k6)

O script [load-tests/menu.test.js](load-tests/menu.test.js) roda com o [k6](https://k6.io) dentro do Docker Compose, então não é preciso instalá-lo. Cada comando sobe a API e o MongoDB, se ainda não estiverem rodando, e executa o teste:

```bash
npm run load:smoke
npm run load:load
npm run load:stress
npm run load:spike
```

| Perfil | Leituras (GET) | Escritas | Duração | Objetivo |
|---|---|---|---|---|
| `smoke` | 10 req/s | 1 ciclo/s | 30 s | Sanidade: tudo responde corretamente |
| `load` | Rampa até 500 req/s, sustentada por 2 min | 5 ciclos/s | ~3 min | Carga esperada em produção |
| `stress` | Rampa até 3000 req/s | 10 ciclos/s | ~3 min | Achar o limite |
| `spike` | De 50 para 3000 req/s em 10 s | 2 ciclos/s | 1,5 min | Pico repentino de acessos |

Como o teste funciona:
- **Preparação:** o `setup` popula o menu com 500 itens em árvore. Para mudar a quantidade, rode o k6 com `-e SEED_ITEMS=<n>`.
- **Leitores:** metade das leituras reenvia o último ETag recebido, simulando um navegador com o menu em cache.
- **Escritores:** cada ciclo cria um item raiz e um filho, tenta criar o filho de novo (e espera 409) e exclui a raiz em cascata (e espera `deletedCount: 2`).
- **Limpeza:** o `teardown` remove tudo o que o teste criou.
- **Critérios de aprovação:** menos de 1% de falhas, mais de 99% de checks aprovados e p95 abaixo do limite de cada perfil.

As leituras usam taxa de chegada constante (*arrival rate*): a carga não diminui quando a API fica lenta, como acontece com usuários reais.

Com o k6 instalado localmente e a API rodando, também dá para executar direto:

```bash
k6 run -e TEST_TYPE=load load-tests/menu.test.js
```

### Variáveis de ambiente

| Variável | Padrão | Descrição |
|---|---|---|
| `PORT` | `3000` | Porta HTTP |
| `MONGO_URL` | `mongodb://localhost:27017` | URL de conexão do MongoDB |
| `MONGO_DB_NAME` | `menu` | Nome do banco |
| `MONGO_MAX_POOL_SIZE` | `50` | Máximo de conexões no pool |
| `MENU_CACHE_TTL_MS` | `5000` | Validade do cache do menu em ms; `0` desliga o cache |

## Endpoints

### `POST /api/v1/menu`: criar item

| Campo | Tipo | Regras |
|---|---|---|
| `name` | string | Obrigatório e único. De 1 a 100 caracteres, após remover espaços nas pontas e colapsar espaços repetidos |
| `relatedId` | string (UUID) | Opcional. Id do item pai; omitido ou `null` cria um item raiz |

```bash
curl -X POST localhost:3000/api/v1/menu \
  -H 'Content-Type: application/json' \
  -d '{"name": "Eletrodomésticos"}'
# 201 {"id":"01a1a7d8-2a2d-71e2-a0e8-9f08f05275e3"}

curl -X POST localhost:3000/api/v1/menu \
  -H 'Content-Type: application/json' \
  -d '{"name": "Televisores", "relatedId": "01a1a7d8-2a2d-71e2-a0e8-9f08f05275e3"}'
# 201 {"id":"01a1a7d8-2a4c-7348-bd3c-3bb5d14ce4d0"}
```

### `DELETE /api/v1/menu/{id}`: excluir item

Exclui o item **e todos os seus sub-itens**.

```bash
curl -X DELETE localhost:3000/api/v1/menu/01a1a7d8-2a4c-7348-bd3c-3bb5d14ce4d0
# 200 {"deletedCount":3}
```

### `GET /api/v1/menu`: consultar menu

Retorna o menu completo. Irmãos aparecem em ordem de criação, e itens sem filhos não têm o campo `submenus`.

```bash
curl localhost:3000/api/v1/menu
```

```json
[
  {
    "id": "01a1a7d8-2a2d-71e2-a0e8-9f08f05275e3",
    "name": "Eletrodomésticos",
    "submenus": [
      {
        "id": "01a1a7d8-2a4c-7348-bd3c-3bb5d14ce4d0",
        "name": "Televisores",
        "submenus": [{ "id": "01a1a7d8-2a5d-7258-b592-c953c0f8e7f1", "name": "LCD" }]
      }
    ]
  },
  { "id": "01a1a7d8-2a78-734c-b1b0-11c744762f3d", "name": "Informática" }
]
```

A resposta inclui `ETag` e `Cache-Control: no-cache`. Se o cliente reenviar o ETag em `If-None-Match` e o menu não tiver mudado, a API responde `304` sem corpo.

### `GET /health`

Responde `200 {"status":"ok"}`. Usado pelo healthcheck do container.

### Erros

Todos os erros seguem o formato `{ "error": { "code": "...", "message": "..." } }`.

| Status | `code` | Quando |
|---|---|---|
| 400 | `INVALID_MENU_ITEM_NAME` | Nome ausente, vazio, que não é texto ou maior que 100 caracteres |
| 400 | `INVALID_MENU_ITEM_ID` | `relatedId` ou `{id}` não é um UUID |
| 400 | `ENTITY_PARSE_FAILED` | JSON malformado |
| 404 | `PARENT_MENU_ITEM_NOT_FOUND` | O `relatedId` não existe |
| 404 | `MENU_ITEM_NOT_FOUND` | O item a excluir não existe |
| 404 | `ROUTE_NOT_FOUND` | Rota inexistente |
| 409 | `MENU_ITEM_NAME_ALREADY_IN_USE` | Já existe um item com esse nome |
| 413 | `ENTITY_TOO_LARGE` | Corpo da requisição acima de 10 KB |
| 500 | `INTERNAL_ERROR` | Erro inesperado (detalhes só no log) |

## Arquitetura

Clean Architecture com DDD, organizada em **screaming architecture**: o primeiro nível de `src/` mostra o que o sistema faz (`menu/`), e as camadas técnicas ficam dentro de cada funcionalidade. Os testes (`*.spec.ts`) ficam ao lado do código que testam.

```
src/
├── menu/
│   ├── domain/                      Regras de negócio, sem dependência de framework
│   │   ├── aggregates/              MenuItem
│   │   ├── value-objects/           MenuItemId (UUID v7), MenuItemName
│   │   ├── services/                buildMenuTree: lista plana → árvore
│   │   ├── repositories/            MenuItemRepository (porta)
│   │   └── errors/
│   ├── application/
│   │   └── use-cases/               create-menu-item, delete-menu-item, get-menu
│   └── infra/
│       ├── database/
│       │   ├── mongo/               Implementação MongoDB
│       │   ├── cache/               Decorator de cache do menu
│       │   ├── in-memory/           Implementação em memória (testes)
│       │   └── menu-item-repository.contract.ts
│       └── http/                    Rotas Express e presenter
├── shared/                          DomainError e suas categorias, contrato UseCase, error handler HTTP
└── main/                            Composition root: config, montagem do app e servidor
```

As dependências apontam sempre para dentro: `infra` → `application` → `domain`. O domínio define a porta `MenuItemRepository`, e a infraestrutura a implementa.

Uma **suíte de contrato** ([menu-item-repository.contract.ts](src/menu/infra/database/menu-item-repository.contract.ts)) roda os mesmos cenários contra todas as implementações do repositório (MongoDB, memória e cache). Isso garante que o repositório em memória usado nos testes se comporta igual ao MongoDB.

## Decisões técnicas

### Ids: UUID v7 gerado no domínio

O id é gerado pela própria entidade, não pelo banco.
- **Sem colisão:** várias instâncias da API geram ids ao mesmo tempo sem conflito e sem contador central.
- **Ordenável por tempo:** os primeiros bits são o timestamp, então ordenar por `_id` já devolve os itens em ordem de criação, usando o índice padrão.
- **Independente do MongoDB:** o domínio não depende do banco para criar uma entidade.

### Modelagem da árvore: referência ao pai + lista de ancestrais

Cada item é um documento próprio:

```json
{ "_id": "…", "name": "LCD", "parentId": "<id de Televisores>", "ancestors": ["<id de Eletrodomésticos>", "<id de Televisores>"] }
```

- **`parentId`:** basta para montar a árvore, o que o GET faz em memória a partir de uma única consulta.
- **`ancestors`** (padrão *Array of Ancestors*): permite excluir uma subárvore inteira com uma única consulta indexada, qualquer que seja a profundidade:
  ```js
  deleteMany({ $or: [{ _id: id }, { ancestors: id }] })
  ```
  Como nenhum item muda de pai depois de criado, essa lista nunca precisa ser atualizada.

### Integridade garantida na escrita

- **Nome único:** índice único em `name`. Duas criações simultâneas com o mesmo nome resultam em uma criação e um 409, sem condição de corrida.
- **Pai existente:** verificado pelo repositório ao montar a lista de ancestrais, na mesma operação de criação. Criar um item custa uma leitura do pai pelo `_id` e um insert.

### Exclusão em cascata

O enunciado não define o que acontece com os sub-itens. Optei por excluí-los junto, que é o comportamento mais intuitivo para um menu e evita itens órfãos.

### Montagem da árvore

O [`buildMenuTree`](src/menu/domain/services/menu-tree.ts) é iterativo, sem recursão. Por isso a profundidade do menu não esbarra no limite da pilha (há um teste com 20 mil níveis). Itens cujo pai não existe são descartados com toda a sua subárvore, para nunca expor um galho solto.

## Desempenho e escala

O menu é lido muito mais do que alterado, então o caminho de leitura foi otimizado em camadas:

1. **Cache do menu** ([cached-menu-item-repository.ts](src/menu/infra/database/cache/cached-menu-item-repository.ts)): guarda a lista de itens em memória por até `MENU_CACHE_TTL_MS`.
   - Escritas da própria instância limpam o cache na hora.
   - Leituras simultâneas com o cache vazio compartilham uma única consulta ao banco (*single-flight*).
   - Uma leitura que começou antes de uma escrita nunca grava dados antigos no cache.
2. **Árvore memorizada:** o `GetMenuUseCase` só remonta a árvore quando a lista de itens muda.
3. **Resposta pré-renderizada:** o router guarda o JSON, a versão gzip e o ETag de cada versão do menu. Enquanto o menu não muda, cada requisição só envia bytes prontos.
4. **ETag e 304:** clientes que já têm a versão atual recebem 304, sem corpo.

Medição local do `GET /api/v1/menu` com 712 itens e 100 requisições simultâneas, com o gerador de carga na mesma máquina:

| Cenário | Antes das camadas 2 e 3 | Depois |
|---|---|---|
| Com gzip | 1.669 req/s | 6.271 req/s |
| Sem compressão | 3.114 req/s | 11.233 req/s |
| 304 Not Modified | 1.778 req/s | 7.284 req/s |

Todas as consultas usam índice, conferido com `explain`: `IXSCAN` no `_id` e em `ancestors`, e `IDHACK` na busca do pai.

### Resultados do k6

A stack rodou no Docker Desktop (VM com 8 CPUs e 4 GB), com uma única instância da API e o k6 na mesma máquina. O menu tinha 500 itens.

| Perfil | Requisições | Falhas | p95 leitura | p99 leitura | p95 escrita |
|---|---|---|---|---|---|
| `smoke` | 935 | 0% | 11,9 ms | 14,5 ms | 7,6 ms |
| `load` (500 req/s) | 74.960 | 0% | 3,9 ms | 11,3 ms | 5,6 ms |
| `stress` (até 3000 req/s) | 282.228 | 0% | 4,5 ms | 23,4 ms | 5,0 ms |
| `spike` (50 → 3000 req/s) | 123.734 | 0% | 1,2 ms | 4,2 ms | 4,7 ms |

- **O gargalo foi o gerador de carga.** Numa amostra durante a rampa do `stress`, por volta de 2500 req/s, a API usava 28% de CPU e o MongoDB 5%, enquanto o k6 consumia 151%. Ou seja, uma única instância tem bastante folga nessa faixa.
- **O banco quase não trabalha.** Mesmo com escritas contínuas, que limpam o cache a cada operação, a maioria das leituras sai da memória.
- **A maioria das revalidações responde 304** (de 87% a 98%). O ETag é um hash do conteúdo, e cada ciclo de escrita cria e exclui seus itens, devolvendo o menu ao mesmo conteúdo e, portanto, ao mesmo ETag.

### Várias instâncias

A API não guarda estado além do cache, então pode ser escalada horizontalmente. Cada instância consulta o MongoDB no máximo uma vez por TTL. Com 50 instâncias e TTL de 5 s, são cerca de 10 consultas por segundo.

O compromisso: uma escrita feita na instância A aparece na instância B em até `MENU_CACHE_TTL_MS`. Se esse atraso não for aceitável, há duas saídas:
- **Redis Pub/Sub:** cada escrita publica um aviso de invalidação, e todas as instâncias limpam o cache local. As leituras continuam saindo da memória e o Redis fica fora do caminho da leitura.
- **Change Streams do MongoDB:** a mesma ideia sem Redis, mas exige que o MongoDB rode como replica set.

## Diferenças em relação ao enunciado

| Enunciado | Implementação | Motivo |
|---|---|---|
| `relatedId` do tipo Number | String (UUID v7) | Ids gerados sem colisão e sem coordenação entre instâncias. Um id numérico sequencial exigiria um contador central no banco |
| Ids de exemplo `"1"`, `"2"`… | UUIDs | Mesmo motivo acima |
| Corpo da resposta do DELETE não especificado | `{ "deletedCount": n }` | Informa quantos itens a exclusão em cascata removeu |
| Comportamento de erros não especificado | 400, 404, 409 e 413, conforme a tabela de erros | Respostas previsíveis e com código estável para o cliente |
