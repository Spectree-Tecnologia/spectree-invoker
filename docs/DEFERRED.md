# Deferred obligations

<!-- Generated from .spectree/deferred.json by delivery.mjs ledger --apply. -->

## D-001 — Infra de CLI duplicada

- Status: open
- Owner: own_change
- Impact: defect
- Decision: Parsing de argv feito à mão em 9 CLIs e git() local em 7 arquivos; a classe 'flag virou valor' já produziu defeito registrado. Adiado para um núcleo shared sobre node:util.parseArgs.
- Due: Roadmap de modularização, tarefa 2 (núcleo shared)
- Closure condition: Nenhum indexOf('--' nem function git( fora de shared, conferido por teste.

## D-002 — Presence no mesmo pacote do runtime de governança

- Status: open
- Owner: own_change
- Impact: defect
- Decision: Presence traz three e ws para o package.json raiz e lib/presence-* importa código de browser e console-server. Adiado até a P4.1 integrar.
- Due: Roadmap de modularização, tarefa 3 (fronteira do Presence)
- Closure condition: package.json raiz sem dependências e um teste que falha se o runtime importar presence/, presence-* ou console-*.

## D-003 — bench/ importa tests/helpers.mjs

- Status: open
- Owner: own_change
- Impact: defect
- Decision: Helpers de fixture viraram API compartilhada sem declaração. Vai junto com a fronteira do Presence.
- Due: Roadmap de modularização, tarefa 3 (fronteira do Presence)
- Closure condition: Nenhum arquivo de bench/ importa de tests/.

## D-004 — scripts/lib plano, com quatro ciclos entre capacidades

- Status: open
- Owner: own_change
- Impact: defect
- Decision: 46 libs soltas; agrupadas em capacidades, o grafo tem 4 ciclos que três movimentos removem. Adiado para a reorganização em módulos com entrada publicada.
- Due: Roadmap de modularização, tarefa 4 (módulos com entrada publicada)
- Closure condition: Teste de fronteira que falha em import profundo entre módulos ou em ciclo no grafo.

## D-005 — Regra de fechamento dentro dos CLIs

- Status: open
- Owner: own_change
- Impact: defect
- Decision: prepare-closure.mjs, state.mjs e post-merge.mjs carregam decisões de fechamento no corpo do CLI, o que obriga os testes a subir processos.
- Due: Roadmap de modularização, tarefa 5 (fechamento como biblioteca)
- Closure condition: Os três CLIs como fachadas finas, cada fluxo de fechamento com teste em processo.

## D-006 — Três caminhos de persistência e ordem de lock só em prosa

- Status: open
- Owner: own_change
- Impact: defect
- Decision: store, lifecycle e work/run-events/delivery-ledger gravam em .spectree cada um do seu jeito; a ordem lifecycle antes de change não está codificada num lugar só.
- Due: Roadmap de modularização, tarefa 5 (fechamento como biblioteca)
- Closure condition: Uma camada de persistência que codifica a ordem de lock, usada por todos os escritores de .spectree.

## D-007 — Suíte lenta por subir CLIs reais

- Status: open
- Owner: own_change
- Impact: ceiling
- Decision: npm test leva 64 s porque 20 dos 36 arquivos sobem processos. Depende do fechamento como biblioteca.
- Due: Roadmap de modularização, tarefa 6 (suíte mais rápida)
- Closure condition: npm test abaixo de 30 s sem perder nenhum cenário.

## D-008 — Protocolo caro de carregar

- Status: open
- Owner: founder
- Impact: ceiling
- Decision: CLAUDE.md gerado tem 77 KB, boa parte justificativa histórica. Separar regra de justificativa depende de decisão de produto.
- Due: Decisão do Founder sobre quanto do porquê fica no contexto (roadmap de modularização, tarefa 8)
- Closure condition: CLAUDE.md com tamanho-alvo decidido e a mesma cobertura de regras, conferida por check-plugin.

