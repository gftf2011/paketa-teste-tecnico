/**
 * Canal para avisar as outras instâncias da aplicação que um cache local
 * ficou desatualizado.
 *
 * A entrega é "no máximo uma vez": mensagens enviadas enquanto uma instância
 * está desconectada se perdem. Por isso quem usa o barramento deve manter um
 * TTL como rede de segurança, e as implementações avisam o assinante quando
 * a conexão é (re)estabelecida, para que ele descarte o que tiver em cache.
 */
export interface CacheInvalidationBus {
  /** Avisa as outras instâncias. Nunca recebe de volta a própria mensagem. */
  publish(): Promise<void>;

  /**
   * Registra quem deve limpar o cache ao receber um aviso de outra instância
   * ou quando a conexão com o barramento é (re)estabelecida.
   */
  subscribe(onInvalidate: () => void): Promise<void>;

  close(): Promise<void>;
}
