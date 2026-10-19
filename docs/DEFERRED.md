# Deferred obligations

<!-- Generated from .spectree/deferred.json by delivery.mjs ledger --apply. -->

## D-001 — Infra de CLI duplicada

- Status: open
- Owner: own_change
- Impact: defect
- Decision: Entregue pela mudança nucleo-shared-cli: scripts/lib/shared/ concentra flags, git e timestamp, e tests/shared-core.test.mjs trava a volta da duplicação. Continua aberto só porque fechar exige evidência observada, que este repositório ainda não registra (D-009).
- Due: Roadmap de modularização, tarefa 2 (núcleo shared)
- Closure condition: Nenhuma leitura manual de valor de flag nem helper git local fora de scripts/lib/shared, conferido por teste, com evidência observada registrada.

## D-002 — Presence no mesmo pacote do runtime de governança

- Status: open
- Owner: own_change
- Impact: defect
- Decision: Entregue pela mudança fronteira-presence: presence/ é o workspace @spectree/presence com three e ws, as bibliotecas de servidor estão em presence/server/ e não importam a Console, e tests/app-boundaries.test.mjs trava a volta. Continua aberto só porque fechar exige evidência observada, que este repositório ainda não registra (D-009).
- Due: Roadmap de modularização, tarefa 3 (fronteira do Presence)
- Closure condition: package.json raiz sem dependências e um teste que falha se o runtime importar presence/, presence-* ou console-*.

## D-003 — bench/ importa tests/helpers.mjs

- Status: open
- Owner: own_change
- Impact: defect
- Decision: Entregue pela mudança fronteira-presence: as fixtures que o bench usa estão em support/fixtures.mjs, e tests/app-boundaries.test.mjs falha se bench/ importar tests/. Continua aberto só porque fechar exige evidência observada (D-009).
- Due: Roadmap de modularização, tarefa 3 (fronteira do Presence)
- Closure condition: Nenhum arquivo de bench/ importa de tests/.

## D-004 — scripts/lib plano, com quatro ciclos entre capacidades

- Status: open
- Owner: own_change
- Impact: defect
- Decision: Entregue pela mudança modulos-runtime: scripts/lib/ são sete módulos, cada um com index.mjs como entrada publicada, o grafo é acíclico e tests/module-graph.test.mjs falha em import profundo ou ciclo. Continua aberto só porque fechar exige evidência observada (D-009).
- Due: Roadmap de modularização, tarefa 4 (módulos com entrada publicada)
- Closure condition: Teste de fronteira que falha em import profundo entre módulos ou em ciclo no grafo.

## D-005 — Regra de fechamento dentro dos CLIs

- Status: open
- Owner: own_change
- Impact: defect
- Decision: Entregue pelas mudanças fechamento-biblioteca-prepare, fechamento-biblioteca-state e fechamento-biblioteca-post-merge: os três CLIs são fachadas finas sobre prepareClosure, stateCommand e confirmMerge em scripts/lib/closure/, cada um com testes em processo. Continua aberto só porque fechar exige evidência observada (D-009).
- Due: Roadmap de modularização, tarefa 5 (fechamento como biblioteca)
- Closure condition: Os três CLIs como fachadas finas, cada fluxo de fechamento com teste em processo.

## D-006 — Três caminhos de persistência e ordem de lock só em prosa

- Status: open
- Owner: own_change
- Impact: defect
- Decision: Entregue pela mudança persistencia-unica: scripts/lib/shared/persistence.mjs tem writeAtomic, writeOnce, publishOnce e withLock, e LOCK_ORDER (executor, lifecycle, change, deferred) é verificado, com recusa E_LOCK_ORDER. Todos os escritores de .spectree gravam por ali, e tests/persistence.test.mjs recusa um escritor fora da camada. Continua aberto só porque fechar exige evidência observada (D-009).
- Due: Roadmap de modularização, tarefa 5 (fechamento como biblioteca)
- Closure condition: Uma camada de persistência que codifica a ordem de lock, usada por todos os escritores de .spectree.

## D-007 — Suíte lenta por subir CLIs reais

- Status: open
- Owner: own_change
- Impact: ceiling
- Decision: A mudança suite-mais-rapida (PR #74) levou npm test de 71 s para 43 s numa VM de 4 vCPU: digest com 5 chamadas ao git em vez de 9, CLIs de fechamento no próprio processo nos testes, os três arquivos mais longos divididos e 8 arquivos em paralelo. Em 2026-10-19 o Gilson aceitou 43 s como o novo teto, no lugar da meta de 30 s. Continua aberto só porque fechar exige evidência observada (D-009).
- Due: Roadmap de modularização, tarefa 6 (suíte mais rápida)
- Closure condition: npm test em até 43 s numa VM de 4 vCPU, sem perder nenhum cenário, com evidência observada registrada.

## D-008 — Protocolo caro de carregar

- Status: open
- Owner: founder
- Impact: ceiling
- Decision: CLAUDE.md gerado tem 77 KB, boa parte justificativa histórica. Separar regra de justificativa depende de decisão de produto.
- Due: Decisão do Founder sobre quanto do porquê fica no contexto (roadmap de modularização, tarefa 8)
- Closure condition: CLAUDE.md com tamanho-alvo decidido e a mesma cobertura de regras, conferida por check-plugin.

## D-009 — O ledger deste repositório não consegue fechar item

- Status: open
- Owner: own_change
- Impact: behaviour
- Decision: Fechar um item exige evidência observada em .spectree/evidence/, e este repositório não abre mudanças estruturadas nem roda state.mjs run. Os itens pagos ficam abertos com a decisão atualizada até isso existir.
- Due: Roadmap de modularização, tarefa 5 (fechamento como biblioteca), ou a primeira mudança deste repositório aberta com state.mjs
- Closure condition: D-001 fechado com closure_evidence de uma execução observada.

## D-010 — state.mjs lê flags depois do separador --

- Status: open
- Owner: own_change
- Impact: defect
- Decision: Entregue pela mudança fechamento-biblioteca-state: init lê flags só antes de --, e tests/state-library.test.mjs prova que uma flag dentro do comando de consolidação é ignorada. Continua aberto só porque fechar exige evidência observada (D-009).
- Due: Roadmap de modularização, tarefa 5 (state.mjs vira um handler por comando)
- Closure condition: init lê flags só antes de --, com teste que prova que uma flag dentro do comando de consolidação é ignorada.

## D-011 — Console recusa argumentos com erro sem código

- Status: open
- Owner: own_change
- Impact: defect
- Decision: Visto pela mudança papeis-do-repositorio: as checagens de argumento em scripts/lib/console/server.mjs lançam Error sem code, e o papel docs/roles/refusals.md pede refuse(code, message). Fica fora porque a tarefa 7 só descreve o código; corrigir é uma mudança de comportamento da Console.
- Due: A próxima mudança que tocar scripts/lib/console/
- Closure condition: Toda recusa de argumento da Console sai por refuse com um código E_, com teste que afirma o código.

