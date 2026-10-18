# Preparação do fechamento como biblioteca

Tarefa 5a do [ciclo de modularização do repositório](../../ROADMAP.md#ciclo--o-repositório-seguindo-a-própria-arquitetura).
Avança o D-005 do [ledger](../../DEFERRED.md), na parte do `prepare-closure.mjs`. O `state.mjs`
(com o D-010) e o `post-merge.mjs` vêm em mudanças próprias, uma por PR.

**Mudança deltaless.** Nenhum comportamento observável do CLI muda: mesmos argumentos, mesma
saída, mesmos códigos de saída. Esta mudança não carrega delta em `specs/`. O critério de saída é
a suíte existente verde, sem expectativa enfraquecida, mais os testes em processo novos.

## Problema

O `prepare-closure.mjs` tinha 1070 linhas de código no nível do módulo. Toda decisão do
fechamento morava no corpo do CLI e terminava em `process.exit`. Por isso cada teste precisava
subir um processo, e nenhum outro código podia chamar a preparação.

## Escopo

1. O corpo do CLI vira `prepareClosure({ root, argv, out, err })` em
   `scripts/lib/closure/prepare.mjs`, publicado pelo `index.mjs` do módulo `closure`. A função
   devolve o código de saída.
2. Cada `process.exit(n)` vira um `Exit(n)` lançado e capturado na borda da função. Nenhum
   `catch` do corpo envolve uma saída, então nenhum deles a engole.
3. `console.log` vira `out` e `console.error` vira `err`. A saída do comando de consolidação,
   que ia direto para o stderr, também passa por `err`.
4. O CLI fica com o cabeçalho de uso e uma chamada: `process.exitCode = prepareClosure(...)`.
   Trocar `process.exit` por `exitCode` deixa o stdout terminar de escrever num pipe.
5. `tests/prepare-closure-library.test.mjs` chama a função no mesmo processo, com a raiz do
   projeto diferente do diretório de trabalho: erro de uso, mudança inexistente, dry run,
   preparação e segunda execução `unchanged`, plano aplicado sobre um controle que andou, e
   flags de recuperação sem nada a recuperar.

## Decisões

- **O corpo foi movido sem reescrever os fluxos.** Separar cada fluxo numa função nomeada é a
  próxima limpeza, e fica mais segura com os testes em processo já de pé.
- **Os testes por processo continuam.** Eles cobrem o que só existe entre processos: escrita
  interrompida no meio e relógio adiantado, os dois injetados por `--require`.
