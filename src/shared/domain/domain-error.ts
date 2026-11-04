/**
 * Base de todos os erros de regra de negócio.
 * O `code` é estável e permite que camadas externas (ex.: HTTP)
 * traduzam o erro sem depender do texto da mensagem.
 */
export abstract class DomainError extends Error {
  abstract readonly code: string;

  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** Dados de entrada que violam uma regra do domínio. */
export abstract class ValidationError extends DomainError {}

/** Recurso referenciado que não existe. */
export abstract class NotFoundError extends DomainError {}

/** Operação que conflita com o estado atual (ex.: unicidade). */
export abstract class ConflictError extends DomainError {}
