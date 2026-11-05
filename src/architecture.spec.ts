import { FileInfo, projectFiles } from 'archunit';

/**
 * Testes de arquitetura (ArchUnitTS): garantem que as regras de camadas,
 * dependências e convenções descritas no README continuem valendo conforme o
 * código evolui. Um teste que não encontra nenhum arquivo falha, então um
 * caminho errado nas regras não passa despercebido.
 *
 * As regras valem para o código de produção. Specs, suítes de contrato e
 * helpers de teste ficam de fora: eles cruzam camadas de propósito (ex.: o
 * teste de um caso de uso usa o repositório em memória da infra).
 */
const TEST_CODE = /\.(spec|contract|test-helper)\.ts$/;
const production = { except: { withName: TEST_CODE } };

/** Arquivos de produção sob um caminho (inclui subpastas). */
const filesIn = (path: string) => projectFiles().inPath(`${path}/**`, production);

/** Módulos importados por um arquivo (`import`, `export ... from`, `require`). */
const importsOf = (file: FileInfo): string[] =>
  [
    ...file.content.matchAll(
      /\bfrom\s+['"]([^'"]+)['"]|\bimport\s+['"]([^'"]+)['"]|\brequire\(\s*['"]([^'"]+)['"]\s*\)/g,
    ),
  ].map((match) => (match[1] ?? match[2] ?? match[3])!);

const isRelative = (module: string) => module.startsWith('.');

/** Condição: o arquivo não importa nenhum módulo que case com `pattern`. */
const notImporting = (pattern: RegExp) => (file: FileInfo) =>
  !importsOf(file).some((module) => pattern.test(module));

describe('Arquitetura', () => {
  describe('camadas do módulo menu (Clean Architecture: dependências só para dentro)', () => {
    it('domain não depende de application, infra nem main', async () => {
      const rule = filesIn('src/menu/domain')
        .shouldNot()
        .dependOnFiles()
        .inPath(/^src\/(menu\/(application|infra)|main|shared\/(application|infra))\//);

      await expect(rule).toPassAsync();
    });

    it('application não depende de infra nem de main', async () => {
      const rule = filesIn('src/menu/application')
        .shouldNot()
        .dependOnFiles()
        .inPath(/^src\/(menu\/infra|main|shared\/infra)\//);

      await expect(rule).toPassAsync();
    });

    it('infra não depende de main', async () => {
      const rule = filesIn('src/menu/infra').shouldNot().dependOnFiles().inPath('src/main/**');

      await expect(rule).toPassAsync();
    });
  });

  describe('composition root e kernel compartilhado', () => {
    it('só main depende de main (composition root)', async () => {
      const rule = projectFiles()
        .inPath('src/**', { except: { inPath: 'src/main/**', withName: TEST_CODE } })
        .shouldNot()
        .dependOnFiles()
        .inPath('src/main/**');

      await expect(rule).toPassAsync();
    });

    it('shared não depende de nenhuma funcionalidade (ex.: menu)', async () => {
      const rule = filesIn('src/shared').shouldNot().dependOnFiles().inPath('src/menu/**');

      await expect(rule).toPassAsync();
    });

    it('shared/domain não depende de shared/application nem de shared/infra', async () => {
      const rule = filesIn('src/shared/domain')
        .shouldNot()
        .dependOnFiles()
        .inPath(/^src\/shared\/(application|infra)\//);

      await expect(rule).toPassAsync();
    });
  });

  describe('ciclos', () => {
    it('o código de produção não tem dependências circulares', async () => {
      const rule = filesIn('src').should().haveNoCycles();

      await expect(rule).toPassAsync();
    });
  });

  describe('isolamento de frameworks e infraestrutura', () => {
    it('domain só importa o próprio código e a biblioteca uuid', async () => {
      const rule = filesIn('src/menu/domain')
        .should()
        .adhereTo(
          (file) => importsOf(file).every((module) => isRelative(module) || module === 'uuid'),
          'domain deve importar apenas módulos relativos ou "uuid"',
        );

      await expect(rule).toPassAsync();
    });

    it('application não importa bibliotecas externas', async () => {
      const rule = filesIn('src/menu/application')
        .should()
        .adhereTo(
          (file) => importsOf(file).every(isRelative),
          'application deve importar apenas módulos relativos',
        );

      await expect(rule).toPassAsync();
    });

    it('express e compression só aparecem na camada HTTP e no composition root', async () => {
      const rule = projectFiles()
        .inPath('src/**', {
          except: {
            inPath: /^src\/(main|menu\/infra\/http|shared\/infra\/http)\//,
            withName: TEST_CODE,
          },
        })
        .should()
        .adhereTo(notImporting(/^(express|compression)$/), 'não deve importar express nem compression');

      await expect(rule).toPassAsync();
    });

    it('o driver do MongoDB só aparece no repositório Mongo e no composition root', async () => {
      const rule = projectFiles()
        .inPath('src/**', {
          except: { inPath: /^src\/(main|menu\/infra\/database\/mongo)\//, withName: TEST_CODE },
        })
        .should()
        .adhereTo(notImporting(/^mongodb$/), 'não deve importar o driver do MongoDB');

      await expect(rule).toPassAsync();
    });

    it('o cliente Redis só aparece no barramento de invalidação de cache', async () => {
      const rule = projectFiles()
        .inPath('src/**', {
          except: { inPath: 'src/shared/infra/cache-invalidation/**', withName: TEST_CODE },
        })
        .should()
        .adhereTo(notImporting(/^ioredis$/), 'não deve importar ioredis');

      await expect(rule).toPassAsync();
    });

    it('o SDK do OpenTelemetry só é configurado em main/telemetry.ts', async () => {
      const rule = projectFiles()
        .inPath('src/**', { except: { inPath: 'src/main/telemetry.ts', withName: TEST_CODE } })
        .should()
        .adhereTo(
          // Fora do bootstrap, só a API do OpenTelemetry (que não faz nada sem o SDK).
          notImporting(/^@opentelemetry\/(?!api$)/),
          'deve usar apenas @opentelemetry/api; SDK e instrumentações ficam em main/telemetry.ts',
        );

      await expect(rule).toPassAsync();
    });

    it('variáveis de ambiente só são lidas em main', async () => {
      const rule = projectFiles()
        .inPath('src/**', { except: { inPath: 'src/main/**', withName: TEST_CODE } })
        .should()
        .adhereTo(
          (file) => !/\bprocess\.env\b/.test(file.content),
          'não deve ler process.env; a configuração entra por main/config.ts',
        );

      await expect(rule).toPassAsync();
    });
  });

  describe('convenções', () => {
    it('arquivos seguem kebab-case', async () => {
      const rule = projectFiles()
        .inPath('src/**')
        .should()
        .haveName(/^[a-z0-9]+(-[a-z0-9]+)*(\.[a-z0-9]+(-[a-z0-9]+)*)*\.ts$/);

      await expect(rule).toPassAsync();
    });

    it('cada caso de uso fica numa pasta com o próprio nome: <nome>/<nome>.use-case.ts', async () => {
      const rule = filesIn('src/menu/application/use-cases')
        .should()
        .adhereTo(
          // `file.name` vem sem a extensão: "create-menu-item.use-case".
          (file) => file.name === `${file.directory.split('/').pop()}.use-case`,
          'casos de uso devem se chamar <pasta>.use-case.ts',
        );

      await expect(rule).toPassAsync();
    });

    it('portas de repositório do domínio terminam em -repository.ts', async () => {
      const rule = filesIn('src/menu/domain/repositories').should().haveName('*-repository.ts');

      await expect(rule).toPassAsync();
    });

    it('arquivos de produção têm menos de 250 linhas', async () => {
      const rule = filesIn('src')
        .should()
        .adhereTo((file) => file.linesOfCode < 250, 'arquivos de produção devem ter menos de 250 linhas');

      await expect(rule).toPassAsync();
    });
  });
});
