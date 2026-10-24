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
- Owner: own_change
- Impact: ceiling
- Decision: Em 2026-10-19 o Gilson escolheu separar regra de justificativa com alvo de 45 KB. A mudança tamanho-do-protocolo levou o CLAUDE.md de 86 KB para menos de 45 KB: as regras ficam no protocolo, o porquê foi para docs/protocol-rationale.md, lido sob demanda, e check-plugin falha se o núcleo renderizado perder uma das regras de protocol/rules.json ou passar de 46.080 bytes. Continua aberto só porque fechar exige evidência observada (D-009).
- Due: Roadmap de modularização, tarefa 8 (tamanho do protocolo)
- Closure condition: CLAUDE.md em até 45 KB com a mesma cobertura de regras, conferida por check-plugin, com evidência observada registrada.

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

## D-012 — Versão e número de teste reservados pelo PR, disputados entre branches paralelas

- Status: open
- Owner: own_change
- Impact: ceiling
- Decision: Visto pela retro em lote do #58 ao #78 (R-001, docs/retros/2026-10-24-lote-58-78.md): 13 heads extras no CI entre o #58 e o #73, todos 'integra main e sobe a candidata' ou id de teste renumerado; 1.33.0 reservada e nunca publicada. Fica fora porque, com uma thread por vez desde o #74, o custo é zero, e a forma de calcular a versão no merge é decisão do Founder.
- Due: Duas threads com PR aberto ao mesmo tempo contra main
- Closure condition: Nenhum PR reserva número de versão ou id sequencial de teste: a versão é calculada no merge e um teste recusa id duplicado.

## D-013 — Tetos de bytes sem folga no núcleo e no card do Architect

- Status: open
- Owner: own_change
- Impact: ceiling
- Decision: Visto pela retro do #78 (R-004, docs/retros/2026-10-24-pass1-superficie.md): CLAUDE.md com 45.934 de 46.080 bytes e o card do Solutions Architect com 34.012 de 34.816. A próxima regra nova no núcleo derruba o check-plugin no meio da change. Fica fora porque é risco medido, sem incidente, e não muda nada do que esta mudança entrega.
- Due: A próxima mudança que acrescentar regra a protocol/rules.json
- Closure condition: check-plugin avisa quando a folga de um teto cai abaixo de 2%, e a proposta que acrescenta regra declara o orçamento de bytes.

## D-014 — Blue team como processo: vigilância de avisos, playbook de incidente e lente red team

- Status: open
- Owner: own_change
- Impact: ceiling
- Decision: Visto no estudo das CVEs de 2026-10-21 (PHP2Shell explorado em massa minutos após a divulgação; RCE Brotli no Node com PoC público). A tarefa 12 pagou os gates de CI e a vigilância diária do lockfile; falta o que olha além do lockfile: uma squad skill do Integration Engineer que cruza avisos citados (OSV, NVD, CISA KEV, fornecedores) com o inventário do projeto, um playbook de incidente do Platform Engineer com o que é decisão do Invoker e o que é gate 3, e a lente red team do Quality Engineer com insumo hostil da classe da CVE. Fica fora porque cada parte é uma mudança de protocolo com autorização própria.
- Due: A próxima mudança autorizada da frente de segurança, ou o primeiro aviso que afete um projeto Spectree
- Closure condition: As duas squad skills existem com um caso real de cada, e o card do Quality Engineer cita a lente red team com um teste que falha no insumo hostil.

## D-015 — Piso de runtime não é verificado nos projetos consumidores

- Status: open
- Owner: own_change
- Impact: ceiling
- Decision: Visto na tarefa 12: o piso de engines e o engine-strict valem para quem instala este repositório, mas os scripts que o instalador entrega rodam no Node do consumidor, e capabilities.mjs só relata a versão. Um consumidor em Node 22.22.0 roda a Presence com o decodificador Brotli vulnerável sem aviso. Fica fora porque muda o comportamento do runtime instalado e merece mudança própria.
- Due: A próxima release de segurança do Node, ou a próxima mudança que tocar capabilities.mjs
- Closure condition: capabilities.mjs compara a versão do Node com um piso declarado num lugar só e relata o runtime abaixo dele como degradado, com teste.

