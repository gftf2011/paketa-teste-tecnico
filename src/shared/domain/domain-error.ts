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
