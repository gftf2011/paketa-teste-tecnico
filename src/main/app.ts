import compression from 'compression';
import express, { Express } from 'express';
import {
  CreateMenuItemUseCase,
  DeleteMenuItemUseCase,
  GetMenuUseCase,
} from '../menu/application';
import { MenuItemRepository } from '../menu/domain';
import { createMenuRouter } from '../menu/infra/http/menu-router';
import { errorHandler, routeNotFoundHandler } from '../shared/infra/http/error-handler';

export interface AppDependencies {
  menuItemRepository: MenuItemRepository;
}

/** Monta a aplicação HTTP. Não abre portas nem conexões, o que facilita os testes. */
export function createApp({ menuItemRepository }: AppDependencies): Express {
  const app = express();

  app.disable('x-powered-by');
  app.use(compression());
  app.use(express.json({ limit: '10kb' }));

  app.get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok' });
  });

  app.use(
    '/api/v1/menu',
    createMenuRouter({
      createMenuItem: new CreateMenuItemUseCase(menuItemRepository),
      deleteMenuItem: new DeleteMenuItemUseCase(menuItemRepository),
      getMenu: new GetMenuUseCase(menuItemRepository),
    }),
  );

  app.use(routeNotFoundHandler);
  app.use(errorHandler);

  return app;
}
