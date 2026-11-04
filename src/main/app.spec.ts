import request from 'supertest';
import { Express } from 'express';
import { MenuItemId } from '../menu/domain';
import { InMemoryMenuItemRepository } from '../menu/infra/database/in-memory/in-memory-menu-item-repository';
import { createApp } from './app';

describe('API /api/v1/menu', () => {
  let app: Express;

  const createItem = async (name: string, relatedId?: string): Promise<string> => {
    const res = await request(app).post('/api/v1/menu').send({ name, relatedId }).expect(201);
    return res.body.id;
  };

  beforeEach(() => {
    app = createApp({ menuItemRepository: new InMemoryMenuItemRepository() });
  });

  describe('POST /api/v1/menu', () => {
    it('cria um item raiz e retorna 201 com o id', async () => {
      const res = await request(app).post('/api/v1/menu').send({ name: 'Eletrodomésticos' });

      expect(res.status).toBe(201);
      expect(res.body).toEqual({ id: expect.any(String) });
      expect(() => MenuItemId.from(res.body.id)).not.toThrow();
    });

    it('cria um sub-item usando relatedId', async () => {
      const parentId = await createItem('Eletrodomésticos');

      await request(app)
        .post('/api/v1/menu')
        .send({ name: 'Televisores', relatedId: parentId })
        .expect(201);
    });

    it('aceita relatedId null como item raiz', async () => {
      await request(app).post('/api/v1/menu').send({ name: 'Informática', relatedId: null }).expect(201);
    });

    it.each([
      ['sem nome', {}],
      ['nome vazio', { name: '   ' }],
      ['nome que não é texto', { name: 123 }],
    ])('retorna 400 com %s', async (_case, body) => {
      const res = await request(app).post('/api/v1/menu').send(body);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_MENU_ITEM_NAME');
    });

    it('retorna 400 com relatedId inválido', async () => {
      const res = await request(app).post('/api/v1/menu').send({ name: 'TV', relatedId: 1 });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_MENU_ITEM_ID');
    });

    it('retorna 400 com JSON malformado', async () => {
      const res = await request(app)
        .post('/api/v1/menu')
        .set('Content-Type', 'application/json')
        .send('{"name":');

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('ENTITY_PARSE_FAILED');
    });

    it('retorna 413 com corpo grande demais', async () => {
      const res = await request(app).post('/api/v1/menu').send({ name: 'a'.repeat(20_000) });

      expect(res.status).toBe(413);
    });

    it('retorna 404 quando o item pai não existe', async () => {
      const res = await request(app)
        .post('/api/v1/menu')
        .send({ name: 'Televisores', relatedId: MenuItemId.generate().value });

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('PARENT_MENU_ITEM_NOT_FOUND');
    });

    it('retorna 409 quando o nome já existe', async () => {
      await createItem('Informática');

      const res = await request(app).post('/api/v1/menu').send({ name: 'Informática' });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('MENU_ITEM_NAME_ALREADY_IN_USE');
    });
  });

  describe('GET /api/v1/menu', () => {
    it('retorna 200 com lista vazia quando não há itens', async () => {
      const res = await request(app).get('/api/v1/menu');

      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    it('retorna o menu do exemplo do desafio', async () => {
      const eletro = await createItem('Eletrodomésticos');
      const tv = await createItem('Televisores', eletro);
      const lcd = await createItem('LCD', tv);
      const v110 = await createItem('110', lcd);
      const v220 = await createItem('220', lcd);
      const plasma = await createItem('Plasma', tv);
      const info = await createItem('Informática');
      const pcs = await createItem('Computadores', info);
      const apple = await createItem('Apple', pcs);
      const macbook = await createItem('MacBook', apple);
      const cabos = await createItem('Cabos', macbook);
      const imac = await createItem('iMac', apple);

      const res = await request(app).get('/api/v1/menu').expect(200);

      expect(res.body).toEqual([
        {
          id: eletro,
          name: 'Eletrodomésticos',
          submenus: [
            {
              id: tv,
              name: 'Televisores',
              submenus: [
                {
                  id: lcd,
                  name: 'LCD',
                  submenus: [
                    { id: v110, name: '110' },
                    { id: v220, name: '220' },
                  ],
                },
                { id: plasma, name: 'Plasma' },
              ],
            },
          ],
        },
        {
          id: info,
          name: 'Informática',
          submenus: [
            {
              id: pcs,
              name: 'Computadores',
              submenus: [
                {
                  id: apple,
                  name: 'Apple',
                  submenus: [
                    { id: macbook, name: 'MacBook', submenus: [{ id: cabos, name: 'Cabos' }] },
                    { id: imac, name: 'iMac' },
                  ],
                },
              ],
            },
          ],
        },
      ]);
    });

    it('responde 304 quando o menu não mudou desde a última leitura', async () => {
      await createItem('Informática');
      const first = await request(app).get('/api/v1/menu').expect(200);

      expect(first.headers['cache-control']).toBe('no-cache');
      await request(app).get('/api/v1/menu').set('If-None-Match', first.headers.etag!).expect(304);

      await createItem('Eletrodomésticos');
      await request(app).get('/api/v1/menu').set('If-None-Match', first.headers.etag!).expect(200);
    });

    it('comprime a resposta quando o cliente aceita gzip', async () => {
      await createItem('Informática');

      const gzip = await request(app).get('/api/v1/menu').set('Accept-Encoding', 'gzip');
      const plain = await request(app).get('/api/v1/menu').set('Accept-Encoding', 'identity');

      expect(gzip.headers['content-encoding']).toBe('gzip');
      expect(plain.headers['content-encoding']).toBeUndefined();
      expect(gzip.body).toEqual(plain.body);
      expect(gzip.headers.etag).toBe(plain.headers.etag);
    });
  });

  describe('DELETE /api/v1/menu/:id', () => {
    it('exclui o item e seus sub-itens e retorna 200', async () => {
      const eletro = await createItem('Eletrodomésticos');
      const tv = await createItem('Televisores', eletro);
      await createItem('LCD', tv);
      const info = await createItem('Informática');

      const res = await request(app).delete(`/api/v1/menu/${tv}`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ deletedCount: 2 });
      const menu = await request(app).get('/api/v1/menu');
      expect(menu.body).toEqual([
        { id: eletro, name: 'Eletrodomésticos' },
        { id: info, name: 'Informática' },
      ]);
    });

    it('retorna 404 quando o item não existe', async () => {
      const res = await request(app).delete(`/api/v1/menu/${MenuItemId.generate().value}`);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('MENU_ITEM_NOT_FOUND');
    });

    it('retorna 400 com id inválido', async () => {
      const res = await request(app).delete('/api/v1/menu/abc');

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_MENU_ITEM_ID');
    });
  });

  it('retorna 404 para rota inexistente', async () => {
    const res = await request(app).get('/api/v1/nada');

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('ROUTE_NOT_FOUND');
  });

  it('retorna 500 sem vazar detalhes em erro inesperado', async () => {
    const repository = new InMemoryMenuItemRepository();
    jest.spyOn(repository, 'findAll').mockRejectedValue(new Error('conexão perdida'));
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    app = createApp({ menuItemRepository: repository });

    const res = await request(app).get('/api/v1/menu');

    expect(res.status).toBe(500);
    expect(res.body).toEqual({
      error: { code: 'INTERNAL_ERROR', message: 'Erro interno do servidor' },
    });
  });

  it('expõe /health', async () => {
    await request(app).get('/health').expect(200, { status: 'ok' });
  });
});
