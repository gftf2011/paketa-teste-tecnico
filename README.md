# API de Menu

Serviço para gestão do menu de um site corporativo. O menu é formado por itens e sub-itens, com **aninhamento infinito**: cada item é um registro independente no banco que aponta para o seu pai, e a API devolve a árvore completa.

**Stack:** Node.js 24, TypeScript, Express 5 e MongoDB 7. No Docker, roda em 3 instâncias atrás de um Nginx, com os caches sincronizados por Redis Pub/Sub e observabilidade via OpenTelemetry.

## Sumário

- [Como rodar](#como-rodar)
- [Endpoints](#endpoints)
- [Exemplos com curl](#exemplos-com-curl)
- [Arquitetura](#arquitetura)
- [Decisões técnicas](#decisões-técnicas)
- [Desempenho e escala](#desempenho-e-escala)
- [Observabilidade](#observabilidade)
- [Diferenças em relação ao enunciado](#diferenças-em-relação-ao-enunciado)

## Como rodar

### Com Docker (recomendado)

Requer apenas Docker.

Para subir tudo de uma vez:

```bash
npm run up
```

O comando constrói a imagem e sobe a stack completa, terminando quando todos os serviços estão saudáveis:
- **API (via Nginx):** `http://localhost:3000`
- **Grafana:** `http://localhost:3001`

```
                      ┌────────────┐
 cliente ─── :3000 ──▶│   Nginx    │ round robin
                      └─────┬──────┘
             ┌──────────────┼──────────────┐
             ▼              ▼              ▼
        ┌─────────┐    ┌─────────┐    ┌─────────┐
        │  api-1  │    │  api-2  │    │  api-3  │   cache em memória em cada uma
        └────┬────┘    └────┬────┘    └────┬────┘
             │   ┌──────────┴──────────┐   │
             ├──▶│ Redis (Pub/Sub)     │◀──┤      avisos de invalidação do cache
             │   └─────────────────────┘   │
             └──────────▶ MongoDB ◀────────┘      dados
                     OTLP ▼
              Grafana LGTM (:3001)                 métricas e traces
```

Veja [Várias instâncias](#várias-instâncias) e [Observabilidade](#observabilidade).

Para desligar tudo:

```bash
npm run down
```

| Comando | O que faz |
|---|---|
| `npm run up` | Sobe tudo: Nginx, 3 réplicas da API, MongoDB, Redis e observabilidade |
| `npm run down` | Para e remove todos os containers do projeto (os dados do MongoDB ficam no volume) |
| `npm run docker:up` | Sobe tudo, menos a observabilidade (imagem de ~3,5 GB) |
| `npm run docker:logs` | Acompanha os logs da API |

Variáveis aceitas pelo Compose:
- **Portas publicadas:** `API_PORT`, `MONGO_PORT`, `REDIS_PORT` e `GRAFANA_PORT` (ex.: `API_PORT=8080 npm run up`).
- **`API_REPLICAS`:** quantidade de instâncias da API; o padrão é 3 (ex.: `API_REPLICAS=5 npm run up`). O Nginx descobre as réplicas pelo DNS do Docker, sem precisar de configuração.
- **`MENU_CACHE_TTL_MS`** e **`MENU_CACHE_REFRESH_DELAY_MS`:** validade do cache do menu e janela de agrupamento das recargas, em ms.
- **`OTEL_SDK_DISABLED=true`:** desliga o OpenTelemetry nas réplicas, para comparar medições.

### Localmente

Requer Node.js 20+ e Docker (só para o MongoDB).

```bash
npm install
npm run dev:docker
```

O MongoDB sobe no Docker e uma única instância da API roda localmente, recarregando a cada alteração. Sem `REDIS_URL`, o cache funciona só com o TTL, o que basta para uma instância. Para usar outro MongoDB, defina `MONGO_URL` e rode `npm run dev`.

Não rode `dev:docker` junto com `docker:up`: os dois usam a porta 3000.

### Testes

```bash
npm test
npm run typecheck
```

Os testes do repositório MongoDB usam o [mongodb-memory-server](https://github.com/typegoose/mongodb-memory-server), que baixa o binário do MongoDB na primeira execução. Não é preciso ter um banco rodando.

Os testes de integração do Redis Pub/Sub precisam de um Redis real e são pulados sem ele. Com a stack no ar (`npm run up`), rode:

```bash
REDIS_URL=redis://localhost:6379 npm test
```

### Testes de arquitetura

```bash
npm run test:architecture
```

[src/architecture.spec.ts](src/architecture.spec.ts) usa o [ArchUnitTS](https://github.com/LukasNiessen/ArchUnitTS) para garantir que a arquitetura descrita aqui continue valendo conforme o código evolui. As regras valem para o código de produção. Specs, suítes de contrato e helpers de teste ficam de fora, porque cruzam camadas de propósito.

| Grupo | Regras |
|---|---|
| Camadas | `domain` não depende de `application`, `infra` nem `main`; `application` não depende de `infra` nem `main`; `infra` não depende de `main` |
| Composition root e kernel | Só `main` depende de `main`; `shared` não depende de `menu`; `shared/domain` não depende de `shared/application` nem `shared/infra` |
| Ciclos | Nenhuma dependência circular no código de produção |
| Frameworks | `domain` só importa código próprio e `uuid`; `application` não importa bibliotecas externas; `express`/`compression` só na camada HTTP e em `main`; `mongodb` só no repositório Mongo e em `main`; `ioredis` só no barramento de invalidação; o SDK do OpenTelemetry só em `main/telemetry.ts` (o resto usa apenas `@opentelemetry/api`); `process.env` só em `main` |
| Convenções | Arquivos em kebab-case; cada caso de uso em `<nome>/<nome>.use-case.ts`; portas de repositório terminam em `-repository.ts`; arquivos de produção com menos de 250 linhas |

Para garantir que as regras funcionam, criei temporariamente arquivos que violavam cada uma delas (o domínio importando a infra e o Express, um ciclo, um nome fora do padrão, entre outros). Todas as 18 regras reprovaram, apontando o arquivo responsável. Uma regra cujo caminho não encontra nenhum arquivo também reprova, então um caminho digitado errado não passa despercebido.

### Testes de carga (k6)

O script [load-tests/menu.test.js](load-tests/menu.test.js) roda com o [k6](https://k6.io) dentro do Docker Compose, então não é preciso instalá-lo. Cada comando sobe a API e o MongoDB, se ainda não estiverem rodando, e executa o teste:

```bash
npm run load:smoke
npm run load:load
npm run load:stress
npm run load:spike
npm run load:burst
```

| Perfil | Leituras (GET) | Escritas | Duração | Objetivo |
|---|---|---|---|---|
| `smoke` | 10 req/s | 1 ciclo/s | 30 s | Sanidade: tudo responde corretamente |
| `load` | Rampa até 500 req/s, sustentada por 2 min | 2 ciclos/s | ~3 min | Carga esperada em produção |
| `stress` | Rampa até 3000 req/s | 2 ciclos/s | ~3 min | Achar o limite |
| `spike` | De 50 para 3000 req/s em 10 s | 2 ciclos/s | 1,5 min | Pico repentino de acessos |
| `burst` | 1000 req/s constantes | Sobe até 20 ciclos/s (60 escritas/s) | 1,5 min | Rajada de escritas: as leituras continuam rápidas? |

Cada ciclo de escrita faz 3 escritas, e cada uma invalida o cache das 3 réplicas. Dois ciclos por segundo já é um ritmo alto para um menu corporativo; o `burst` mede à parte o efeito de uma rajada.

Como o teste funciona:
- **Preparação:** o `setup` popula o menu com 500 itens em árvore. Para mudar a quantidade, rode o k6 com `-e SEED_ITEMS=<n>`.
- **Leitores:** metade das leituras reenvia o último ETag recebido, simulando um navegador com o menu em cache.
- **Escritores:** cada ciclo cria um item raiz e um filho, tenta criar o filho de novo (e espera 409) e exclui a raiz em cascata (e espera `deletedCount: 2`).
- **Limpeza:** o `teardown` remove tudo o que o teste criou.
- **Critérios de aprovação:** menos de 1% de falhas, mais de 99% de checks aprovados e p95 abaixo do limite de cada perfil.

As leituras usam taxa de chegada constante (*arrival rate*): a carga não diminui quando a API fica lenta, como acontece com usuários reais.

Com `-e GZIP=1`, as leituras pedem resposta comprimida, como um navegador. Isso reduz a CPU da API e do Nginx, mas o k6 passa a descompactar cada resposta. Com o k6 rodando na mesma máquina que a API, o gerador vira o gargalo antes do servidor, então o padrão é sem gzip.

**Limite da máquina:** os perfis `stress` e `spike` (3000 req/s) saturam um computador que roda ao mesmo tempo o k6, 3 réplicas, o Nginx, o MongoDB e o Grafana. Só o k6 chega a usar de 2 a 4 CPUs. Nessa situação o resultado varia até 2 vezes entre rodadas idênticas (ver [Resultados do k6](#resultados-do-k6)). Para medir a capacidade real, rode o k6 em outra máquina.

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
| `MENU_CACHE_REFRESH_DELAY_MS` | `50` | Janela para agrupar escritas numa única recarga do cache, em ms |
| `REDIS_URL` | (vazio) | Redis usado para sincronizar o cache entre instâncias. Sem ele, cada instância depende só do TTL |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | (vazio) | Endpoint OTLP/HTTP do coletor. Sem ele, a telemetria fica desligada |
| `OTEL_SERVICE_NAME` | `menu-api` | Nome do serviço na telemetria |
| `OTEL_TRACES_SAMPLER_ARG` | `1` (`0.1` no Compose) | Fração das requisições que viram trace |
| `OTEL_METRIC_EXPORT_INTERVAL` | `15000` (`10000` no Compose) | Intervalo de envio das métricas, em ms |

## Endpoints

### `POST /api/v1/menu`: criar item

| Campo | Tipo | Regras |
|---|---|---|
| `name` | string | Obrigatório e único. De 1 a 100 caracteres, após remover espaços nas pontas e colapsar espaços repetidos |
| `relatedId` | string (UUID) | Opcional. Id do item pai; omitido ou `null` cria um item raiz |

Responde `201 {"id": "<uuid>"}`. O corpo precisa ser JSON com `Content-Type: application/json`.

### `DELETE /api/v1/menu/{id}`: excluir item

Exclui o item **e todos os seus sub-itens**. Responde `200 {"deletedCount": n}`, com o total de itens removidos.

### `GET /api/v1/menu`: consultar menu

Retorna o menu completo. Irmãos aparecem em ordem de criação, e itens sem filhos não têm o campo `submenus`.

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

Exemplos de cada caso estão na seção [Exemplos com curl](#exemplos-com-curl).

## Exemplos com curl

Os exemplos precisam da API rodando (`npm run up` ou `npm run docker:up`) e do [jq](https://jqlang.org), usado para guardar os ids. Os comandos podem ser colados direto no terminal (bash ou zsh), na ordem em que aparecem; a resposta esperada vem logo abaixo de cada um. Os ids variam a cada execução; os das respostas são ilustrativos.

### Montar o menu do enunciado

Cria os 12 itens do exemplo do desafio. Cada linha guarda o id do item criado numa variável, usada como `relatedId` dos filhos:

```bash
API=http://localhost:3000/api/v1/menu

ELETRO=$(curl -s -X POST "$API" -H 'Content-Type: application/json' -d '{"name": "Eletrodomésticos"}' | jq -r .id)
TV=$(curl -s -X POST "$API" -H 'Content-Type: application/json' -d '{"name": "Televisores", "relatedId": "'$ELETRO'"}' | jq -r .id)
LCD=$(curl -s -X POST "$API" -H 'Content-Type: application/json' -d '{"name": "LCD", "relatedId": "'$TV'"}' | jq -r .id)
V110=$(curl -s -X POST "$API" -H 'Content-Type: application/json' -d '{"name": "110", "relatedId": "'$LCD'"}' | jq -r .id)
V220=$(curl -s -X POST "$API" -H 'Content-Type: application/json' -d '{"name": "220", "relatedId": "'$LCD'"}' | jq -r .id)
PLASMA=$(curl -s -X POST "$API" -H 'Content-Type: application/json' -d '{"name": "Plasma", "relatedId": "'$TV'"}' | jq -r .id)

INFO=$(curl -s -X POST "$API" -H 'Content-Type: application/json' -d '{"name": "Informática"}' | jq -r .id)
PCS=$(curl -s -X POST "$API" -H 'Content-Type: application/json' -d '{"name": "Computadores", "relatedId": "'$INFO'"}' | jq -r .id)
APPLE=$(curl -s -X POST "$API" -H 'Content-Type: application/json' -d '{"name": "Apple", "relatedId": "'$PCS'"}' | jq -r .id)
MACBOOK=$(curl -s -X POST "$API" -H 'Content-Type: application/json' -d '{"name": "MacBook", "relatedId": "'$APPLE'"}' | jq -r .id)
CABOS=$(curl -s -X POST "$API" -H 'Content-Type: application/json' -d '{"name": "Cabos", "relatedId": "'$MACBOOK'"}' | jq -r .id)
IMAC=$(curl -s -X POST "$API" -H 'Content-Type: application/json' -d '{"name": "iMac", "relatedId": "'$APPLE'"}' | jq -r .id)

curl -s "$API" | jq
```

O GET devolve a mesma árvore do enunciado, com UUIDs no lugar dos ids numéricos:

```json
[
  {
    "id": "01a1a8f3-f94d-74d6-9923-9fa576e8bba9",
    "name": "Eletrodomésticos",
    "submenus": [
      {
        "id": "01a1a8f3-f95c-758d-8d85-bf2f89220263",
        "name": "Televisores",
        "submenus": [
          {
            "id": "01a1a8f3-f96f-76b8-88c9-c12026f6e88b",
            "name": "LCD",
            "submenus": [
              { "id": "01a1a8f3-f97f-732f-8180-26d28ae58623", "name": "110" },
              { "id": "01a1a8f3-f98e-7143-9546-390a1e68a3e5", "name": "220" }
            ]
          },
          { "id": "01a1a8f3-f99f-7151-b4c4-36941574cb8f", "name": "Plasma" }
        ]
      }
    ]
  },
  {
    "id": "01a1a8f3-f9b0-73da-9131-3e5b7a2f47e1",
    "name": "Informática",
    "submenus": [
      {
        "id": "01a1a8f3-f9c0-760e-83bf-bb6d49dbeba0",
        "name": "Computadores",
        "submenus": [
          {
            "id": "01a1a8f3-f9d3-720b-8e3e-17c4fc4eee79",
            "name": "Apple",
            "submenus": [
              {
                "id": "01a1a8f3-f9e5-75df-b56a-61e11322c0b6",
                "name": "MacBook",
                "submenus": [{ "id": "01a1a8f3-f9f7-73cc-bc34-0cf1880230ae", "name": "Cabos" }]
              },
              { "id": "01a1a8f3-fa09-72d8-a07f-a5ad90e16c0a", "name": "iMac" }
            ]
          }
        ]
      }
    ]
  }
]
```

As variáveis `ELETRO`, `TV`, `INFO` etc. continuam valendo para os exemplos seguintes.

### Criar itens

Item raiz:

```bash
curl -X POST "$API" -H 'Content-Type: application/json' -d '{"name": "Linha Branca"}'
```

```text
201 {"id":"01a1a8f3-b896-764b-953c-dcef4961ae78"}
```

Sub-item, informando o id do pai em `relatedId`:

```bash
curl -X POST "$API" -H 'Content-Type: application/json' -d '{"name": "Geladeiras", "relatedId": "'$ELETRO'"}'
```

```text
201 {"id":"01a1a8f3-b8be-723d-ab07-930e1c95c162"}
```

`relatedId: null` também cria um item raiz:

```bash
curl -X POST "$API" -H 'Content-Type: application/json' -d '{"name": "Celulares", "relatedId": null}'
```

```text
201 {"id":"01a1a8f3-b8d0-72d6-aea1-4afc438aa28a"}
```

Espaços nas pontas são removidos e espaços repetidos viram um só. Este item é salvo como `"Ar Condicionado"`:

```bash
curl -X POST "$API" -H 'Content-Type: application/json' -d '{"name": "  Ar   Condicionado  "}'
```

```text
201 {"id":"01a1a8f3-b8de-776b-9eed-f72858e9c174"}
```

### Erros ao criar

Nome que já existe. A comparação é feita depois de normalizar os espaços, então `" Informática "` conflita com `"Informática"`:

```bash
curl -X POST "$API" -H 'Content-Type: application/json' -d '{"name": " Informática "}'
```

```text
409 {"error":{"code":"MENU_ITEM_NAME_ALREADY_IN_USE","message":"Já existe um item de menu com o nome \"Informática\""}}
```

Nome ausente:

```bash
curl -X POST "$API" -H 'Content-Type: application/json' -d '{}'
```

```text
400 {"error":{"code":"INVALID_MENU_ITEM_NAME","message":"O nome do item de menu deve ser um texto"}}
```

Nome que não é texto:

```bash
curl -X POST "$API" -H 'Content-Type: application/json' -d '{"name": 123}'
```

```text
400 {"error":{"code":"INVALID_MENU_ITEM_NAME","message":"O nome do item de menu deve ser um texto"}}
```

Nome vazio ou só com espaços:

```bash
curl -X POST "$API" -H 'Content-Type: application/json' -d '{"name": "   "}'
```

```text
400 {"error":{"code":"INVALID_MENU_ITEM_NAME","message":"O nome do item de menu é obrigatório"}}
```

Nome com mais de 100 caracteres (aqui, 101 letras "a"):

```bash
curl -X POST "$API" -H 'Content-Type: application/json' -d '{"name": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}'
```

```text
400 {"error":{"code":"INVALID_MENU_ITEM_NAME","message":"O nome do item de menu deve ter no máximo 100 caracteres"}}
```

`relatedId` que não é um UUID, como o número do enunciado original:

```bash
curl -X POST "$API" -H 'Content-Type: application/json' -d '{"name": "Plasma", "relatedId": 1}'
```

```text
400 {"error":{"code":"INVALID_MENU_ITEM_ID","message":"\"1\" não é um id de item de menu válido"}}
```

`relatedId` válido, mas de um item que não existe:

```bash
curl -X POST "$API" -H 'Content-Type: application/json' -d '{"name": "Plasma", "relatedId": "0192f3a4-1b2c-7d3e-8f40-123456789abc"}'
```

```text
404 {"error":{"code":"PARENT_MENU_ITEM_NOT_FOUND","message":"Item de menu pai \"0192f3a4-1b2c-7d3e-8f40-123456789abc\" não encontrado"}}
```

JSON malformado:

```bash
curl -X POST "$API" -H 'Content-Type: application/json' -d '{"name": '
```

```text
400 {"error":{"code":"ENTITY_PARSE_FAILED","message":"Unexpected end of JSON input"}}
```

Corpo acima de 10 KB. Rodando na raiz do projeto, o próprio `package-lock.json` (cerca de 270 KB) serve de corpo:

```bash
curl -X POST "$API" -H 'Content-Type: application/json' --data-binary @package-lock.json
```

```text
413 {"error":{"code":"ENTITY_TOO_LARGE","message":"request entity too large"}}
```

Sem o cabeçalho `Content-Type: application/json`, o corpo não é lido e o nome chega vazio:

```bash
curl -X POST "$API" -d '{"name": "Plasma"}'
```

```text
400 {"error":{"code":"INVALID_MENU_ITEM_NAME","message":"O nome do item de menu deve ser um texto"}}
```

### Consultar o menu

Menu completo:

```bash
curl "$API"
```

```text
200 [{"id":"…","name":"Eletrodomésticos","submenus":[…]},{"id":"…","name":"Informática","submenus":[…]}, …]
```

Formatado:

```bash
curl -s "$API" | jq
```

Só os cabeçalhos (`-I` faz uma requisição HEAD):

```bash
curl -I "$API"
```

```text
HTTP/1.1 200 OK
Content-Type: application/json; charset=utf-8
Cache-Control: no-cache
ETag: "cYtu8ZWiTa1M8xBfp1TBRxqRZKQ"
Vary: Accept-Encoding
X-Upstream-Addr: 172.21.0.5:3000
...
```

Com compressão gzip:

```bash
curl -I -H 'Accept-Encoding: gzip' "$API"
```

```text
HTTP/1.1 200 OK
Content-Encoding: gzip
...
```

Revalidação com ETag. O primeiro comando guarda o ETag no arquivo `etag.txt`; o segundo o reenvia em `If-None-Match` e, se o menu não mudou, recebe `304` sem corpo:

```bash
curl -s -o /dev/null --etag-save etag.txt "$API"
```

```bash
curl -i --etag-compare etag.txt "$API"
```

```text
HTTP/1.1 304 Not Modified
```

Depois de qualquer criação ou exclusão que mude o menu, o mesmo ETag passa a receber `200` com o menu novo.

### Excluir itens

Excluir um item remove também todos os seus sub-itens. Excluir "Televisores" remove ele, "LCD", "110", "220" e "Plasma":

```bash
curl -X DELETE "$API/$TV"
```

```text
200 {"deletedCount":5}
```

Item que não existe, ou que já foi excluído:

```bash
curl -X DELETE "$API/$TV"
```

```text
404 {"error":{"code":"MENU_ITEM_NOT_FOUND","message":"Item de menu \"01a1a8f3-f95c-758d-8d85-bf2f89220263\" não encontrado"}}
```

Id que não é um UUID:

```bash
curl -X DELETE "$API/abc"
```

```text
400 {"error":{"code":"INVALID_MENU_ITEM_ID","message":"\"abc\" não é um id de item de menu válido"}}
```

Excluir as raízes remove as árvores inteiras:

```bash
curl -X DELETE "$API/$ELETRO"
```

```text
200 {"deletedCount":2}
```

```bash
curl -X DELETE "$API/$INFO"
```

```text
200 {"deletedCount":6}
```

"Eletrodomésticos" remove 2 itens porque, a essa altura, só restava "Geladeiras" embaixo dele. Os outros itens criados nos exemplos ("Linha Branca", "Celulares" e "Ar Condicionado") se excluem do mesmo jeito, pelo id devolvido na criação. Para apagar todo o menu de uma vez, derrube a stack junto com o volume do MongoDB:

```bash
docker compose down -v
```

### Outras rotas

Rota ou método inexistente:

```bash
curl -X PUT "$API/$INFO"
```

```text
404 {"error":{"code":"ROUTE_NOT_FOUND","message":"Rota PUT /api/v1/menu/01a1a8f3-f9b0-73da-9131-3e5b7a2f47e1 não encontrada"}}
```

Health check:

```bash
curl http://localhost:3000/health
```

```text
200 {"status":"ok"}
```

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
│       ├── http/                    Rotas Express e presenter
│       └── observability/           Métricas de negócio do menu (OpenTelemetry)
├── shared/
│   ├── domain/                      DomainError e suas categorias
│   ├── application/                 Contrato UseCase
│   └── infra/
│       ├── cache-invalidation/      Barramento de invalidação de cache (porta, Redis e memória)
│       ├── http/                    Error handler
│       └── observability/           Helper de métricas para testes
└── main/                            Composition root: config, telemetria, montagem do app e servidor

nginx/default.conf                   Balanceador de carga (round robin)
observability/                       Dashboard e provisionamento do Grafana
load-tests/                          Testes de carga (k6)
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
   - **Stale-while-revalidate:** uma escrita, nesta ou em outra instância (ver [Várias instâncias](#várias-instâncias)), não apaga o cache; ela o marca como desatualizado. As leituras seguem respondendo da memória com a versão anterior enquanto **uma única** recarga roda em segundo plano. Nenhuma leitura espera o MongoDB, exceto a primeira de uma instância recém-iniciada.
   - **Escritas em rajada viram uma recarga só:** escritas dentro de `MENU_CACHE_REFRESH_DELAY_MS` (50 ms) são agrupadas. Se chegar outra escrita durante a recarga, o resultado é descartado e uma nova recarga é agendada.
   - **O mesmo vale quando o TTL vence:** responde com a versão anterior e recarrega em segundo plano. Se a recarga falha, a versão anterior continua sendo servida e a próxima leitura tenta de novo.
   - **O preço:** por cerca de 50 ms mais uma consulta depois de uma escrita, uma leitura pode devolver a versão anterior, inclusive na própria instância que escreveu. Atrás do Nginx isso já acontecia: a leitura seguinte do cliente cai, em geral, em outra réplica.
   - **Single-flight:** leituras simultâneas com o cache vazio compartilham uma única consulta ao banco.
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

A stack rodou no Docker Desktop (VM com 8 CPUs e 4 GB), com o k6 na mesma máquina. O menu tinha 500 itens. Estas medições são de antes do Nginx: uma única instância da API, acessada diretamente. A medição com 3 réplicas está em [Várias instâncias](#várias-instâncias).

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

No Docker, a API roda em **3 réplicas** (`API_REPLICAS`) atrás de um **Nginx** que distribui as requisições em round robin. A API não guarda estado além do cache, então escala horizontalmente.

**Nginx** ([nginx/default.conf](nginx/default.conf)):
- **Descoberta das réplicas:** o upstream aponta para `api:3000` com a opção `resolve`. O DNS do Docker devolve um IP por réplica, e o Nginx o consulta de novo a cada 5 s, então réplicas novas ou recriadas entram no rodízio sem reiniciar o Nginx.
- **Conexões reaproveitadas:** usa `keepalive` com as réplicas, em vez de abrir uma conexão TCP por requisição.
- **Réplica fora do ar:** se uma réplica cai, o Nginx tenta a próxima. Isso vale só para requisições idempotentes; um POST nunca é repetido.
- **Cabeçalho `X-Upstream-Addr`:** mostra qual réplica respondeu, o que deixa o round robin visível.

**Cache sincronizado por Redis Pub/Sub.** Cada réplica tem seu próprio cache em memória. Sem sincronização, uma escrita feita na réplica A só apareceria na réplica B quando o TTL vencesse. Com o Redis:

```
POST /api/v1/menu ─▶ api-1: grava no MongoDB ─▶ marca o cache como desatualizado ─▶ PUBLISH menu:cache:invalidated <id da api-1>
                                                                                              │
                     api-2, api-3 ◀────────────────── SUBSCRIBE menu:cache:invalidated ◀─────┘
                     marcam o cache como desatualizado e recarregam em segundo plano (~50 ms),
                     seguindo com a versão anterior enquanto isso
```

- **O Redis só transporta o aviso, não o menu.** As leituras continuam saindo da memória de cada réplica, então o Redis fica fora do caminho da leitura e não acrescenta latência a ela.
- **Cada réplica ignora o próprio aviso.** A mensagem leva o id da réplica que publicou.
- **Uma falha do Redis não falha a escrita,** que já foi gravada no MongoDB. O aviso perdido é contado na métrica `menu.cache.invalidation.publish_failures`, e as outras réplicas se atualizam pelo TTL.
- **Redis fora do ar não segura requisições.** A conexão de publicação não enfileira comandos enquanto está offline, então o `publish` falha na hora em vez de esperar.
- **Reconexão:** ao reconectar, cada réplica assina o canal de novo e descarta o cache, porque mensagens enviadas durante a queda foram perdidas. O Pub/Sub entrega "no máximo uma vez", por isso o TTL continua valendo como rede de segurança.
- **A API sobe mesmo sem Redis:** espera até 5 s pela assinatura e segue em frente; a assinatura é feita assim que o Redis estiver disponível.

A implementação fica atrás da porta [`CacheInvalidationBus`](src/shared/infra/cache-invalidation/cache-invalidation-bus.ts), com dois adaptadores: [Redis](src/shared/infra/cache-invalidation/redis-cache-invalidation-bus.ts) e [memória](src/shared/infra/cache-invalidation/in-memory-cache-invalidation-bus.ts). O cache não sabe que o Redis existe. Os testes simulam várias instâncias com o adaptador em memória, e o adaptador Redis tem testes de integração com um Redis real, incluindo uma queda forçada da conexão.

**Verificação na stack**, com as réplicas rodando com TTL de 10 minutos para que só o Pub/Sub explique a atualização:

| Passo | Resultado |
|---|---|
| 6 GETs pelo Nginx | Rodízio entre as 3 réplicas: `.6`, `.7`, `.5`, `.6`, `.7`, `.5` |
| POST, seguido de GETs imediatos | Algumas réplicas ainda devolvem a versão anterior (stale-while-revalidate) |
| Os mesmos GETs 200 ms depois | As 3 réplicas devolvem o item novo; o mesmo vale para o DELETE |
| Redis parado, POST (caiu na `.7`) | 201: a escrita funciona. Só a `.7` mostra o item novo; as outras ficam com o menu antigo |
| Redis religado | As 3 réplicas reconectam, descartam o cache e voltam a concordar |

**k6 pelo Nginx** (perfil `load`, 500 req/s com escritas contínuas, 3 réplicas):

| Requisições | Falhas | p95 leitura | p99 leitura | p95 escrita | Por réplica |
|---|---|---|---|---|---|
| 74.751 | 0% | 11,9 ms | 42,9 ms | 12,8 ms | ~25.830 cada |

- **Contagem de invalidações:** foram 2.967 locais e 6.239 remotas. Cada escrita avisou as outras duas réplicas, e nenhum aviso falhou.
- **Latência maior que na instância única direta** (3,9 ms):
  - **Salto extra:** toda requisição passa pelo Nginx.
  - **Trabalho triplicado:** o teste faz cerca de 15 escritas por segundo sem parar, e cada uma limpa o cache das 3 réplicas. Cada réplica remonta, serializa e comprime o menu a cada escrita, então esse trabalho passa a acontecer 3 vezes.
  - **CPU dividida:** tudo divide a mesma VM de 8 CPUs com o k6, o MongoDB e o Grafana.

  Num menu real, que muda poucas vezes por dia, quase todas as leituras saem da resposta pronta em memória.

Essa medição é de antes do stale-while-revalidate. Os resultados depois dele estão logo abaixo.

**Rajadas de escrita.** Antes, cada escrita apagava o cache de todas as réplicas, e as leituras seguintes esperavam o MongoDB. Com o stale-while-revalidate e as recargas agrupadas, o perfil `burst` (1000 leituras/s e até 60 escritas/s):

| | Antes | Depois |
|---|---|---|
| p95 leitura | 1,18 s | **5,5 ms** |
| p95 escrita | 1,03 s | **7,4 ms** |
| Requisições/s (alvo: 1000) | 650 | **1.045** |
| Iterações que o k6 não conseguiu disparar | 31.556 | **105** |
| Revalidações respondidas com 304 | 33% | **85%** |
| Leituras que esperaram o MongoDB (`miss` + `coalesced`) | ~25.800 | **0** |

**`stress` (alvo de 3000 req/s), com o mesmo script nas duas versões** (o perfil anterior, com 10 ciclos de escrita/s):

| | Antes | Depois (2 rodadas) |
|---|---|---|
| Requisições/s | 800 | 966 a 1.486 |
| p95 leitura | 1,1 s | 187 a 638 ms |
| Falhas | 0% | 0% |

Esse perfil satura a máquina: rodando junto com as réplicas, o k6 usou de 2,2 a 3,8 CPUs. Para entender o limite, testei também sem o Grafana, sem o Nginx (k6 direto nas réplicas) e sem o OpenTelemetry. Em todos os casos o throughput ficou na mesma faixa, de 700 a 1.500 req/s, e duas rodadas idênticas chegaram a variar quase 2 vezes. O limite é desta máquina rodando tudo junto, não de um componente específico.
## Observabilidade

A API é instrumentada com [OpenTelemetry](https://opentelemetry.io) e envia **traces e métricas** via OTLP/HTTP. A configuração fica em [src/main/telemetry.ts](src/main/telemetry.ts), carregado antes de qualquer outro módulo.

### Como ver

```bash
npm run up
```

Além da API e do MongoDB, sobe a imagem [grafana/otel-lgtm](https://github.com/grafana/docker-otel-lgtm), que reúne OTel Collector, Prometheus, Tempo, Loki e Grafana. A imagem tem cerca de 3,5 GB, por isso fica num profile separado.

- **Dashboard:** http://localhost:3001/d/menu-api (sem login). A porta pode ser trocada com `GRAFANA_PORT`.
- **Traces:** link "Traces no Tempo" no topo do dashboard, ou *Explore → Tempo* com `{resource.service.name="menu-api"}`.

Para ver os gráficos com movimento, gere carga com `npm run load:load`.

Sem o Grafana rodando (`npm run docker:up`), a API tenta exportar e falha em silêncio, sem afetar as requisições. Fora do Docker, a telemetria só liga se `OTEL_EXPORTER_OTLP_ENDPOINT` estiver definido.

### O que é coletado

**Traces** (10% das requisições no Compose, ajustável por `OTEL_TRACES_SAMPLER_ARG`):

```
POST /api/v1/menu                       (HTTP: método, rota, status, app.error.code)
├── request handler - /api/v1/menu      (Express)
├── find menu_items                     (MongoDB: busca do pai)
├── insert menu_items                   (MongoDB)
└── publish                             (Redis: aviso às outras instâncias)
```

- **Erros:** respostas com erro levam o atributo `app.error.code`. Erros 5xx marcam o span como falha e anexam a exceção.
- **Fora dos traces:** a rota `/health`, os middlewares (JSON, compressão) e as camadas de router do Express não geram spans. Só o handler da rota vira span, e a rota já vai como atributo no span HTTP (`http.route`).

**Métricas:**

| Métrica | Tipo | Origem |
|---|---|---|
| `http.server.request.duration` | Histograma (rota, método, status) | Instrumentação HTTP + Express |
| `menu.cache.requests` | Contador (`hit`, `stale`, `miss`, `coalesced`) | Cache do menu |
| `menu.items.created` | Contador | Rota de criação |
| `menu.items.deleted` | Contador (inclui a cascata) | Rota de exclusão |
| `app.errors` | Contador (código do erro, status) | Error handler |
| `menu.cache.invalidations` | Contador (`local`, `remote`) | Cache do menu |
| `menu.cache.invalidation.publish_failures` | Contador | Cache do menu (aviso ao Redis que falhou) |
| `db.client.connection.count` | Gauge (`idle`, `used`) | Instrumentação MongoDB |
| `nodejs.eventloop.*`, `v8js.*` | Event loop, heap e GC | Instrumentação de runtime |

O histograma de latência usa buckets a partir de 0,1 ms. Os buckets padrão começam em 5 ms, e a API costuma responder abaixo de 1 ms; com eles, o p50 e o p95 virariam só uma interpolação dentro do primeiro bucket.

As métricas de negócio usam só a API do OpenTelemetry (`@opentelemetry/api`): sem o SDK inicializado, como nos testes, elas não fazem nada. Os testes usam um `MeterProvider` em memória para verificar os valores.

### Dashboard

O dashboard [observability/grafana/dashboards/menu-api.json](observability/grafana/dashboards/menu-api.json) é provisionado automaticamente e tem quatro seções:

1. **Visão geral:** requisições/s, latência p95, taxa de erros 5xx e cache hit ratio.
2. **Tráfego HTTP (RED):** requisições/s por rota, respostas por status, latência p50, p95 e p99 por rota e requisições/s por instância (mostra o round robin).
3. **Menu e cache:** leituras por resultado no cache, itens criados e excluídos, erros por código, invalidações por origem (local ou remota) e falhas ao avisar outras instâncias.
4. **Runtime Node.js e MongoDB:** utilização e atraso do event loop, heap, GC e pool de conexões.

### Custo

Medi a CPU das réplicas a partir do cgroup de cada container, com 1000 leituras/s, depois de uma rodada de aquecimento: 0,69 ms de CPU por requisição sem OpenTelemetry e 0,60 ms com ele, uma diferença dentro do ruído. No perfil `load` (500 req/s), o p95 de leitura foi de 3,9 ms sem telemetria e de 4,2 ms com ela.

Em produção, o Grafana, o Prometheus e o Tempo ficam em hosts separados. Aqui eles dividem a máquina com a API, e a amostragem de traces (10% no Compose, ajustável por `OTEL_TRACES_SAMPLER_ARG`) limita quanto trabalho eles recebem.

## Diferenças em relação ao enunciado

| Enunciado | Implementação | Motivo |
|---|---|---|
| `relatedId` do tipo Number | String (UUID v7) | Ids gerados sem colisão e sem coordenação entre instâncias. Um id numérico sequencial exigiria um contador central no banco |
| Ids de exemplo `"1"`, `"2"`… | UUIDs | Mesmo motivo acima |
| Corpo da resposta do DELETE não especificado | `{ "deletedCount": n }` | Informa quantos itens a exclusão em cascata removeu |
| Comportamento de erros não especificado | 400, 404, 409 e 413, conforme a tabela de erros | Respostas previsíveis e com código estável para o cliente |
