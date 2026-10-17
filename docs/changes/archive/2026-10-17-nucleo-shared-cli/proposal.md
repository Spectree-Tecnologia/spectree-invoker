# Núcleo shared e utilitários de CLI

Tarefa 2 do [ciclo de modularização do repositório](../../../ROADMAP.md#ciclo--o-repositório-seguindo-a-própria-arquitetura).
Fecha, em código, o [D-001](../../../DEFERRED.md).

**Mudança deltaless.** Nenhum comportamento observável do runtime muda, com uma exceção
declarada abaixo. Esta mudança não carrega delta em `specs/`. O critério de saída é a suíte
existente verde, sem expectativa enfraquecida, mais o teste de guarda novo.

## Problema

Os CLIs liam o valor de uma flag cada um à sua maneira, e a regra "uma flag seguida de outra
flag não tem valor" estava escrita à mão em cada um. O `verify-change.mjs` esqueceu a regra:
`--head --json` usava `--json` como revisão. O mesmo padrão se repetia nos helpers locais de
`git`, que eram 7, e no `stamp()`, que tinha 3 cópias.

## Escopo

1. `scripts/lib/shared/`, sem dependência de nenhum outro módulo do runtime:
   - `cli.mjs`: `flags(argv)` com `has` e `value`, com a regra escrita uma vez;
   - `git.mjs`: `git(root, args, options)`;
   - `guard.mjs`: `refuse` e `inside`, que saem de `work.mjs`. Esse é o primeiro dos três
     movimentos que quebram os ciclos da tarefa 4;
   - `time.mjs`: `stamp()`.
2. Migração para o núcleo:
   - leitura de flags: `state`, `prepare-closure`, `post-merge`, `ci-treatment`, `verify-change`
     e `bench/delivery`;
   - helpers git: `digest` (4), `state`, `post-merge`, `mutation`, `agent-evals` e `flow-evals`;
   - os 18 módulos que importavam `refuse` e `inside` de `work.mjs` passam a importar de `shared`.
3. O instalador passa a copiar os quatro arquivos de `shared/`.
4. `tests/shared-core.test.mjs` falha se voltar uma leitura manual de flag, um helper git local
   ou um `stamp` duplicado. Cada guarda é mostrada rejeitando a forma antiga antes de valer.

## Decisões

- **Não usar `node:util.parseArgs`**, ao contrário do que o roadmap previa. No modo estrito ele
  recusa flags desconhecidas. No modo solto ele aceita `--reason --apply` como valor. Qualquer um
  dos dois mudaria o que os CLIs aceitam hoje, e esta mudança é deltaless.
- **Cada chamada mantém as opções que tinha.** O `state.mjs` continua deixando o stderr do git no
  terminal e com o buffer padrão. O `prepare-closure` continua distinguindo `--reason ""` de
  nenhuma flag (`emptyIsValue`).
- **Chamadas git avulsas dentro de funções de domínio ficam onde estão.** Não são helpers e mudam
  junto com a reorganização em módulos (D-004).

## Exceção declarada

`verify-change.mjs --head` sem revisão, ou seguido de outra flag, passa a sair com o uso (código 2).
Antes, sem valor ele comparava contra HEAD em silêncio, e com uma flag ele tentava comparar contra o
nome da flag. É a classe de defeito que esta mudança existe para fechar, e o teste a cobre.

## Ausências declaradas

- `writeAtomic` continua em `store.mjs`; a mudança para `shared` acontece na tarefa 4.
- A leitura de flags pelo `init` depois de `--` fica registrada como D-010.
- O D-001 continua aberto no ledger, porque fechar exige evidência observada (D-009).

## Critério de saída

- `tests/shared-core.test.mjs` verde aqui e vermelho na base `e4a2796`.
- `build.mjs --check`, `check-plugin.mjs`, `delivery.mjs ledger` e a suíte completa verdes.
- O teste `5e2` verde: tudo o que é instalado resolve seus imports no consumidor.
