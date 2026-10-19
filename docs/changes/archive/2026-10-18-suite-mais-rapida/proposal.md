# Suíte mais rápida

Tarefa 6 do [ciclo de modularização do repositório](../../../ROADMAP.md#ciclo--o-repositório-seguindo-a-própria-arquitetura).
Avança o D-007 do [ledger](../../../DEFERRED.md), sem fechá-lo: a suíte caiu de 71 s para 43 s
nesta máquina, e a meta é 30 s.

**Mudança deltaless.** Nenhum comportamento observável muda. Esta mudança não carrega delta em
`specs/`. O critério de saída é a suíte existente verde, com os mesmos cenários, sem expectativa
enfraquecida.

## Problema

Medido numa VM de 4 vCPU, a mesma configuração do CI: `npm test` levava 71 s e consumia 171 s
de CPU. Quase todo esse tempo era espera por processos filhos, e não JavaScript. Os maiores
consumidores eram:

- cada chamada a `contentDigest` subia 9 processos `git`, e a suíte fazia cerca de 1.800 delas;
- os testes subiam os CLIs de fechamento como processos (cerca de 630 vezes, uns 90 ms cada),
  embora desde a tarefa 5 cada CLI seja uma fachada fina sobre uma função de biblioteca;
- três arquivos (`cli-cycle`, `sequences`, `task-executor`) levavam de 28 s a 53 s cada e
  ficavam sozinhos no fim da execução.

## Escopo

1. `contentDigest` pergunta ao git 5 vezes em vez de 9:
   - `rev-parse` devolve prefixo, revisão e árvore numa chamada;
   - um só `ls-files -s --cached --others` lista os caminhos e o índice, e o estágio do índice
     responde o que `ls-files -u` respondia;
   - o `status` já pedido para `dirty` responde o que `ls-files -m` respondia
     (`worktreeModified`), e o índice já listado é passado a `normalisedHashes`.
2. `tests/helpers.mjs` ganha `closureCli`. Ele chama a função por trás de `state.mjs`,
   `prepare-closure.mjs` e `post-merge.mjs` no próprio processo, com o mesmo código de saída e o
   mesmo texto. Quando a chamada carrega um shim por `NODE_OPTIONS` (relógio, queda, barreira), ou
   quando o teste pede o processo, ele sobe o processo como antes.
3. `tests/closure-facades.test.mjs` mantém as duas formas iguais (código, stdout e recusa) para
   os três CLIs.
4. Os três arquivos longos foram divididos por assunto, e a fixture de cada um foi para um
   módulo `tests/<nome>-fixture.mjs`. Nenhum teste mudou de conteúdo.
5. `gitRepo` grava a configuração do repositório de teste num só arquivo, em vez de três
   chamadas a `git config`.
6. `npm test` roda 8 arquivos em paralelo em vez de 4. Os testes passam a maior parte do tempo
   esperando processos filhos, e 8 mediu melhor que 4 e 6 nesta máquina.

## Resultado

| Medida | Antes | Depois |
|---|---|---|
| `npm test`, tempo real (duas execuções) | 71,5 s e 70,6 s | 43,1 s e 43,4 s |
| CPU total | 171 s | cerca de 118 s |
| Testes | 564 | 567 (os 3 novos da equivalência das fachadas) |

## Decisões

- **O que ainda sobe processo continua subindo.** Os testes com shim de relógio, de queda ou de
  barreira precisam de um processo novo, e os testes do CLI instalado em `lifecycle`,
  `planner-cli`, `reliability-install` e `acceptance-regressions` continuam como estavam. O
  executor de tarefas continua chamando `state.mjs plan` como processo, porque `execution` não
  pode importar `closure`.
- **Não há cache de digest.** Guardar o resultado de `contentDigest` entre chamadas cortaria
  mais, mas reabre a classe de defeito em que uma evidência continua válida depois de uma edição.
- **A meta de 30 s não foi atingida.** O que sobra é, na maior parte, espera por `git` e por
  `node` em testes de ponta a ponta. O D-007 continua aberto, e a decisão sobre o resto fica com o
  Gilson.
