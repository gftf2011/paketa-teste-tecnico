import { Meter, metrics } from '@opentelemetry/api';
import compression from 'compression';
import express, { Express } from 'express';
import {
  CreateMenuItemUseCase,
  DeleteMenuItemUseCase,
  GetMenuUseCase,
} from '../menu/application';
import { MenuItemRepository } from '../menu/domain';
import { createMenuRouter } from '../menu/infra/http/menu-router';
import { MenuMetrics } from '../menu/infra/observability/menu-metrics';
import { createErrorHandler, routeNotFoundHandler } from '../shared/infra/http/error-handler';

export interface AppDependencies {
  menuItemRepository: MenuItemRepository;
  /** Meter usado nas métricas da aplicação; padrão: o global do OpenTelemetry. */
  meter?: Meter;
  menuMetrics?: MenuMetrics;
}

/** Monta a aplicação HTTP. Não abre portas nem conexões, o que facilita os testes. */
export function createApp({
  menuItemRepository,
  meter = metrics.getMeter('menu-api'),
  menuMetrics = new MenuMetrics(meter),
}: AppDependencies): Express {
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
      metrics: menuMetrics,
    }),
  );

  app.use(routeNotFoundHandler);
  app.use(createErrorHandler(meter));

  return app;
}
