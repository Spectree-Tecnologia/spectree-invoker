# Confirmação pós-merge como biblioteca

Tarefa 5c do [ciclo de modularização do repositório](../../../ROADMAP.md#ciclo--o-repositório-seguindo-a-própria-arquitetura).
Entrega em código o D-005 do [ledger](../../../DEFERRED.md): depois do `prepare-closure.mjs` (5a) e do
`state.mjs` (5b), o `post-merge.mjs` é o último dos três CLIs de fechamento a virar fachada fina. O
D-006 (uma camada de persistência só) fica para a 5d, numa mudança própria.

**Mudança deltaless.** Nenhum comportamento observável do CLI muda: mesmos argumentos, mesma
saída, mesmos códigos de saída. Esta mudança não carrega delta em `specs/`. O critério de saída é
a suíte existente verde, sem expectativa enfraquecida, mais os testes em processo novos.

## Problema

O `post-merge.mjs` tinha 565 linhas de código no nível do módulo, com cinco `process.exit`. Os
testes da confirmação só conseguiam chamá-la subindo um processo.

## Escopo

1. O corpo do CLI vira `confirmMerge({ root, argv, out, err })` em
   `scripts/lib/closure/post-merge.mjs`, publicado pelo `index.mjs` do `closure`, e devolve o
   código de saída.
2. As saídas viram `Exit`, como na 5a e na 5b. Nenhum `catch` do corpo envolve uma saída.
3. O CLI fica com o cabeçalho de uso e uma chamada: `process.exitCode = confirmMerge(...)`.
4. `tests/post-merge.test.mjs` ganha três testes em processo, com a raiz do projeto fora do
   diretório de trabalho e o mesmo `gh` simulado dos testes por processo:
   - erros de uso;
   - o merge aprovado, planejado, fechado e confirmado de novo sem mudar nada;
   - o merge com outro conteúdo, recusado.

## Decisões

- **O corpo foi movido sem reescrever a confirmação**, como na 5a. Os testes por processo
  continuam e passaram sem edição.
- **O D-006 sai desta mudança.** Juntar as gravações em `.spectree` numa camada só mexe em
  `store`, `lifecycle`, `work`, `run-events` e `delivery-ledger`, o que é outra unidade de
  trabalho.
