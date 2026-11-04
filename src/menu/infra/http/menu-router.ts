import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { Router } from 'express';
import {
  CreateMenuItemUseCase,
  DeleteMenuItemUseCase,
  GetMenuOutput,
  GetMenuUseCase,
} from '../../application';
import { MenuMetrics } from '../observability/menu-metrics';
import { toMenuResponse } from './menu-presenter';

export interface MenuRouterDependencies {
  createMenuItem: CreateMenuItemUseCase;
  deleteMenuItem: DeleteMenuItemUseCase;
  getMenu: GetMenuUseCase;
  metrics: MenuMetrics;
}

interface RenderedMenu {
  json: Buffer;
  etag: string;
  gzip?: Buffer;
}

export function createMenuRouter(deps: MenuRouterDependencies): Router {
  const router = Router();

  // Resposta do GET já serializada, por versão do menu. Enquanto o menu não
  // muda, cada requisição só copia bytes prontos: sem montar, serializar,
  // comprimir ou calcular o hash do corpo de novo.
  const renderedMenus = new WeakMap<GetMenuOutput, RenderedMenu>();
  const render = (menu: GetMenuOutput): RenderedMenu => {
    let rendered = renderedMenus.get(menu);
    if (!rendered) {
      const json = Buffer.from(JSON.stringify(toMenuResponse(menu)));
      rendered = { json, etag: `"${createHash('sha1').update(json).digest('base64url')}"` };
      renderedMenus.set(menu, rendered);
    }
    return rendered;
  };

  router.post('/', async (req, res) => {
    const body: Record<string, unknown> =
      typeof req.body === 'object' && req.body !== null ? req.body : {};

    const { id } = await deps.createMenuItem.execute({
      name: body.name,
      relatedId: body.relatedId,
    });

    deps.metrics.recordItemCreated();
    res.status(201).json({ id });
  });

  router.delete('/:id', async (req, res) => {
    const { deletedCount } = await deps.deleteMenuItem.execute({ id: req.params.id });

    deps.metrics.recordItemsDeleted(deletedCount);
    res.status(200).json({ deletedCount });
  });

  router.get('/', async (req, res) => {
    const rendered = render(await deps.getMenu.execute());

    // `no-cache` + ETag: o cliente sempre revalida e recebe 304 sem corpo
    // quando o menu não mudou.
    res.set({
      'Cache-Control': 'no-cache',
      'Content-Type': 'application/json; charset=utf-8',
      ETag: rendered.etag,
      Vary: 'Accept-Encoding',
    });

    if (req.fresh) {
      res.status(304).end();
      return;
    }

    if (req.acceptsEncodings('gzip', 'identity') === 'gzip') {
      rendered.gzip ??= gzipSync(rendered.json);
      res.set('Content-Encoding', 'gzip').status(200).send(rendered.gzip);
      return;
    }

    res.status(200).send(rendered.json);
  });

  return router;
}
