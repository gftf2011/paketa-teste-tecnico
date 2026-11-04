import { ErrorRequestHandler, RequestHandler } from 'express';
import {
  ConflictError,
  DomainError,
  NotFoundError,
  ValidationError,
} from '../../domain/domain-error';

interface ErrorResponse {
  error: { code: string; message: string };
}

const statusForDomainError = (error: DomainError): number => {
  if (error instanceof ValidationError) return 400;
  if (error instanceof NotFoundError) return 404;
  if (error instanceof ConflictError) return 409;
  return 422;
};

/** Erros do próprio Express/body-parser (JSON malformado, corpo grande demais...). */
const isClientHttpError = (
  error: unknown,
): error is { status: number; type?: string; message: string } =>
  typeof error === 'object' &&
  error !== null &&
  'status' in error &&
  typeof error.status === 'number' &&
  error.status >= 400 &&
  error.status < 500;

export const routeNotFoundHandler: RequestHandler = (req, res) => {
  const body: ErrorResponse = {
    error: { code: 'ROUTE_NOT_FOUND', message: `Rota ${req.method} ${req.path} não encontrada` },
  };
  res.status(404).json(body);
};

export const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  let status = 500;
  let body: ErrorResponse = { error: { code: 'INTERNAL_ERROR', message: 'Erro interno do servidor' } };

  if (error instanceof DomainError) {
    status = statusForDomainError(error);
    body = { error: { code: error.code, message: error.message } };
  } else if (isClientHttpError(error)) {
    status = error.status;
    body = {
      error: {
        code: (error.type ?? 'invalid.request').replace(/\./g, '_').toUpperCase(),
        message: error.message,
      },
    };
  } else {
    console.error(error);
  }

  res.status(status).json(body);
};
