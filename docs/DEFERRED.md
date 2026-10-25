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
- Decision: Visto pela retro do #78 (R-004, docs/retros/2026-10-24-pass1-superficie.md): CLAUDE.md com 45.934 de 46.080 bytes e o card do Solutions Architect com 34.012 de 34.816. A próxima regra nova no núcleo derruba o check-plugin no meio da change. Fica fora porque é risco medido, sem incidente, e não muda nada do que esta mudança entrega. Atualizado pela mudança seguranca-resposta: a Seção 4 ganhou 68 bytes para citar as skills de segurança, e o CLAUDE.md está com 46.002 de 46.080 bytes (78 de folga). O gatilho disparou na mudança checagens-por-relatorio: a regra da suíte única levou o CLAUDE.md a 46.178 bytes e derrubou o check-plugin; ela coube cortando 142 bytes de redação repetida do §7 e do §12, e o núcleo terminou com 46.036 (44 de folga). Segunda ocorrência do R-004, então a próxima regra nova paga o teto ou o corte numa mudança deltaless própria. Na mudança regras-de-volta-ao-nucleo as regras devolvidas levaram o CLAUDE.md a 48.996 bytes, e o teto subiu para 49.152 (156 de folga), por decisão do Founder em 2026-10-25; terceira vez que o teto do núcleo decide o escopo de uma mudança (R-004).
- Due: A próxima mudança que acrescentar regra a protocol/rules.json
- Closure condition: check-plugin avisa quando a folga de um teto cai abaixo de 2%, e a proposta que acrescenta regra declara o orçamento de bytes.

## D-014 — Blue team como processo: vigilância de avisos, playbook de incidente e lente red team

- Status: open
- Owner: own_change
- Impact: ceiling
- Decision: Visto no estudo das CVEs de 2026-10-21 (PHP2Shell explorado em massa minutos após a divulgação; RCE Brotli no Node com PoC público). A tarefa 12 pagou os gates de CI e a vigilância diária do lockfile; falta o que olha além do lockfile: uma squad skill do Integration Engineer que cruza avisos citados (OSV, NVD, CISA KEV, fornecedores) com o inventário do projeto, um playbook de incidente do Platform Engineer com o que é decisão do Invoker e o que é gate 3, e a lente red team do Quality Engineer com insumo hostil da classe da CVE. Fica fora porque cada parte é uma mudança de protocolo com autorização própria. Entregue pela mudança seguranca-resposta (v1.50.0): squad-security-watch, squad-incident-response e a lente red team no card do Quality Engineer. Continua aberto até o primeiro caso real usar as skills, e porque fechar exige evidência observada (D-009).
- Due: A próxima mudança autorizada da frente de segurança, ou o primeiro aviso que afete um projeto Spectree
- Closure condition: As duas squad skills existem com um caso real de cada, e o card do Quality Engineer cita a lente red team com um teste que falha no insumo hostil.

## D-015 — Piso de runtime não é verificado nos projetos consumidores

- Status: open
- Owner: own_change
- Impact: ceiling
- Decision: Visto na tarefa 12: o piso de engines e o engine-strict valem para quem instala este repositório, mas os scripts que o instalador entrega rodam no Node do consumidor, e capabilities.mjs só relata a versão. Um consumidor em Node 22.22.0 roda a Presence com o decodificador Brotli vulnerável sem aviso. Fica fora porque muda o comportamento do runtime instalado e merece mudança própria. Entregue pela mudança seguranca-piso-consumidor (v1.52.0): satisfiesFloor no shared e o fato runtime.floor no capabilities.mjs, provados num consumidor instalado. Continua aberto só porque fechar exige evidência observada (D-009).
- Due: A próxima release de segurança do Node, ou a próxima mudança que tocar capabilities.mjs
- Closure condition: capabilities.mjs compara a versão do Node com um piso declarado num lugar só e relata o runtime abaixo dele como degradado, com teste.

## D-016 — Aprovação de integração não escala com o risco

- Status: open
- Owner: founder
- Impact: ceiling
- Decision: Visto no discovery do REVIEW.md (2026-10-25): scope-policy.mjs recusa founder_policy em qualquer gate que não seja scope, então toda ida à main espera o OK do Founder na thread, seja documentação ou runtime. A retro em lote do #58 ao #78 mediu PRs verdes parados 51 h (#76), 10 h (#67) e 9 h (#74) só esperando esse OK, e o Founder já contorna com OK permanente por lote. Fica fora porque muda o significado do gate da main, que é decisão do Founder.
- Due: A decisão do Founder sobre integração por política, ou o próximo OK permanente por lote
- Closure condition: Um item do ROADMAP marcado pelo Founder autoriza integração por política só para candidato cujo ci-treatment não seja full, salvo se o item disser que cobre runtime, com recusa testada no record-approval.

## D-017 — Regras do núcleo que o #76 deixou só na justificativa

- Status: open
- Owner: own_change
- Impact: defect
- Decision: Visto pela verificação da mudança revisao-independente: os dois revisores em contexto limpo sobre o diff do #76 acharam frases normativas que saíram do núcleo e ficaram só em docs/protocol-rationale.md, que se declara não vinculante. Na main 4a51738 continuam fora do CLAUDE.md, entre outras: at most three attempts, up to ten total; no successful rerun erases an unresolved failure; all completed Scenarios must pass again; Changed inputs invalidate their evidence; a reviewed complete test inventory; negative control first. O inventário de protocol/rules.json casa só a frase de abertura de cada regra, então um corpo esvaziado passa no check-plugin (é a causa do R-009). Fica fora porque devolver regra ao núcleo muda o protocolo e esbarra no teto do D-013. Entregue pela mudança regras-de-volta-ao-nucleo (v1.61.0): as 258 frases normativas que o #76 tirou do núcleo foram classificadas por um revisor em contexto limpo (206 mantidas reescritas, 34 justificativa, 18 perdidas); 11 das perdidas que mandam em agente voltaram ao §7, junto com os 11 trechos achados antes e 2 frases sem marca normativa achadas na revisão, uma já estava na skill squad-closure-retro, e as 6 que descrevem o runtime de fechamento estão nomeadas na proposta. O check-plugin passou a listar cada frase normativa do núcleo em core_normative e recusa a que some sem sair da lista, visto recusando o diff do #76 (258 frases, a do R-009 entre elas). Continua aberto porque fechar exige evidência observada (D-009), e a cobertura tem limite declarado: a classificação partiu das frases com marca normativa, e core_normative cobre só o núcleo, não os cards nem as frases sem marca.
- Due: A próxima mudança que tocar protocol/07-pipeline-and-method.md ou protocol/rules.json
- Closure condition: Cada frase normativa do núcleo anterior ao #76 está de volta ao núcleo ou nomeada como removida numa proposta, e o check-plugin recusa uma regra cujo corpo normativo sumiu, visto rejeitando o diff do #76.

## D-018 — Escrita fora dos caminhos do papel barrada na hora

- Status: open
- Owner: own_change
- Impact: ceiling
- Decision: Visto no discovery de mods do Claude Code (/mnt/project-files/analysis/mods-claude-code-vs-invoker.md, 2026-10-25): a posse de caminhos por papel é verificada depois, pelo verify-change, e não barrada quando a escrita acontece. Um hook PreToolUse clássico, que lê o agent_type e nega Edit/Write fora dos caminhos do papel e qualquer escrita do loop principal, converteria parte disso em recusa na hora. Fica fora porque não há incidente: nenhuma retro, item deste ledger ou recusa do verify-change registra escrita fora de caminho, e um hook só vale no Claude Code, não no Codex.
- Due: A primeira recusa real do verify-change por caminho fora do papel, ou a primeira edição manual de docs/specs/ detectada, num projeto consumidor
- Closure condition: Um hook PreToolUse clássico (não function hook) recusa a escrita fora dos caminhos do papel, visto recusando o caso do incidente, e a linha enforced da matriz de papéis diz exatamente o que ele cobre e em qual harness.

## D-019 — Memória do projeto contradita pelo código sem ninguém ver

- Status: open
- Owner: own_change
- Impact: ceiling
- Decision: Visto no discovery da LLM Wiki (/mnt/project-files/analysis/llm-wiki-vs-invoker.md, 2026-10-25): uma entrada de docs/DOMAIN.md ou docs/DECISIONS.md contradita pelo código, ou superada sem registro, hoje só é pega se o Architect ler na hora. O lint de memória da wiki é a ideia aproveitável. Fica fora porque não há incidente em campo, e a resposta esperada é um check ou um passo da squad-closure-retro, nunca um papel.
- Due: Uma retro de projeto consumidor que registre uma pergunta ao Founder sobre fato já gravado em DOMAIN.md ou DECISIONS.md, ou uma entrada desses arquivos contradita pelo código e não detectada pelo Architect
- Closure condition: Um check determinístico ou um passo da squad-closure-retro aponta a entrada contradita, visto rejeitando o caso do incidente.

## D-020 — Pass 2 por tarefa, durante a execução

- Status: open
- Owner: own_change
- Impact: ceiling
- Decision: Proposto pelo Invoker do SYND (relatório de 2026-10-25 sobre o tempo do pass 2): atacar cada tarefa assim que o executor a verifica, em paralelo com as próximas. Fica fora porque contradiz a regra da 1.54.0 (o pass 2 ataca o candidato que vai ser integrado, sobre o fechamento preparado) e encosta no isolamento do QE. A rodada incremental do pass 2 vem antes e é medida primeiro.
- Due: A rodada incremental do pass 2 integrada e medida em um projeto consumidor, com o pass 2 ainda dominando o tempo entre implemented e pass2_complete
- Closure condition: Decisão registrada: o ataque por tarefa adotado sem enfraquecer o pass 2 final sobre o fechamento preparado, ou descartado com a medição que o justifica.

## D-021 — Correção depois de pass2_complete fora do executor

- Status: open
- Owner: own_change
- Impact: defect
- Decision: A mudança executor-pos-fechamento abre repair e verify só enquanto a change está em implemented, onde chegam os achados do pass 2. Um CI vermelho depois de pass2_complete ainda volta ao Developer por despacho direto, sem o orçamento e a trilha do executor. Fica fora porque nenhum projeto relatou o caso e a volta de estado que ele pede é decisão de protocolo.
- Due: Um projeto consumidor registra uma correção feita fora do executor depois de pass2_complete
- Closure condition: A correção pedida depois de pass2_complete passa por tasks.mjs repair, com o estado e a evidência do pass 2 invalidados de forma explícita, visto num teste.

