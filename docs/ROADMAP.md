# Roadmap do Spectree Invoker

Atualizado em 2026-10-25. Este documento registra a ordem aprovada e seus motivos.
O escopo e os critérios de cada entrega pertencem à respectiva proposta de mudança;
esta sequência não representa funcionalidades já disponíveis nem compromissos de data.

## Base entregue

O pacote **1.14.0 — Fundação Presence** foi integrado, com a demonstração
visual P1. O runtime mantém os gates, a execução resiliente e as evidências da
1.13.0. A [Console](console.md) oferece observabilidade local somente para leitura.
A entrega **1.15.0 — Sessão Presence Codex** acrescenta integração textual local
com o harness (P2). A **1.16.0 — Conversa Realtime** integra a fundação de áudio
P3 e a conversa contínua P3-R, pelo [PR #48](https://github.com/Spectree-Tecnologia/spectree-invoker/pull/48).
Os especialistas audíveis são o próximo incremento, ainda não disponível.

## Ciclo 1.14 — Spectree Presence

Objetivo aprovado: conversar com o Invoker por voz e acompanhar a participação
dos especialistas por personagens expressivos, com identidade e fala atribuídas.
A interface operacional terá uma superfície própria; a Console continua sendo
a ferramenta de observabilidade.

A direção visual foi aprovada pelo Founder: Invoker branco, especialistas com
cores próprias, olhos que acompanham o cursor e reação à fala. O estudo aprovado
é um protótipo com áudio gravado, sem conexão com agentes reais. Consulte a
[referência visual](design/presence.md).

| Ordem | Entrega | Estado | Por que vem nesta posição / evidência para avançar |
|---|---|---|---|
| P1 | Fundação visual e contrato de estados | Integrada em main, PR #41 / v1.14.0 | Componente Three.js local, áudio demonstrativo analisado e estados determinísticos. [Uso](presence.md), [proposta](changes/archive/2026-10-14-presence-fundacao/proposal.md) e [verificação e limites](changes/archive/2026-10-14-presence-fundacao/verification.md). |
| P2 | Sessão local e integração Codex | Integrada em main, PR #43 / v1.15.0 | Texto e eventos por app-server/stdio, autenticação local ChatGPT, thread efêmera sem ambientes, resposta incremental e interrupção. [Uso](presence-codex.md), [proposta](changes/archive/2026-10-15-presence-sessao-codex/proposal.md) e [verificação](changes/archive/2026-10-15-presence-sessao-codex/verification.md). |
| P3 | Fundação de áudio do Invoker | Integrada em main, PR #48 / v1.16.0 | Captura explícita, transcrição revisável, síntese e seleção de microfone. [Uso](presence-voice.md), [proposta](changes/archive/2026-10-17-presence-voz-invoker/proposal.md) e [verificação](changes/archive/2026-10-17-presence-voz-invoker/verification.md). Disponível como modo por gravações; a conversa contínua é P3-R. |
| P3-R | Conversa Realtime com o Invoker | Integrada em main, PR #48 / v1.16.0; aceita pelo Founder | WebRTC, turnos automáticos, interrupção pela fala e consulta Codex confirmada. [Uso](presence-realtime.md), [proposta](changes/archive/2026-10-17-presence-realtime/proposal.md) e [verificação](changes/archive/2026-10-17-presence-realtime/verification.md). 469/469 testes Windows; [CI do merge](https://github.com/Spectree-Tecnologia/spectree-invoker/actions/runs/38998524893) aprovada e tag no commit `8c7b099`. |
| P4 | Comunicação entre Invoker e subagentes do squad | P4.1 implementada em branch; P4.2–P4.3 pendentes | Registro dos seis papéis, sessão por delegação, validação e cancelamento por instância. [API textual P4.1](presence-squad.md), [proposta e aceite](changes/presence-dialogo-squad/proposal.md), [incrementos](changes/presence-dialogo-squad/tasks.md) e [verificação](changes/presence-dialogo-squad/verification.md). Personagens e vozes ainda pendentes. |
| P5 | Continuidade e recuperação da experiência | Planejada | Endurecer reconexão, retomada, interrupção pelo usuário e prevenção de ações ou falas duplicadas. Os mecanismos básicos de cancelamento e limpeza já são exigidos desde a etapa que os introduz. |
| P6 | Canário e preparação da entrega | Planejada | Validar a jornada completa em projeto descartável: compatibilidade com gates, acessibilidade, desempenho, instalação e custo observado. Consolidar evidências e instruções operacionais antes de recomendar merge/release. |

## Decisões que orientam a sequência

- O primeiro harness será o Codex. O suporte conversacional ao Claude fica para
  uma entrega posterior, sem alterar o suporte existente do plugin ao Claude Code.
- A intenção é utilizar a assinatura do usuário pela autenticação oficial do
  harness. A compatibilidade do transporte será verificada em P2; APIs de áudio
  têm contratação e orçamento próprios. O teto dos ensaios foi ampliado de US$ 2
  para US$ 6. Reservas conhecidas: US$ 5,30; saldo conservador US$ 0,70,
  sem consulta ao faturamento. P4 começa com planejamento e testes sem API paga.
- Um coordenador local de sessão fará a ponte entre interface, harness e áudio.
  A interface não recebe credenciais de longa duração nem acesso arbitrário ao disco.
- A fala entre agentes apresenta delegações, progresso e resultados públicos.
  Ela não reproduz raciocínio interno, nem transforma animação em evidência de execução.
- O runtime continua sendo a autoridade sobre gates e ações. Uma animação ou
  resposta falada não concede aprovação; comandos com efeito precisam passar
  pelo fluxo de autorização aplicável.
- Testes de integração usam apenas canários. `spectree-workspace` e `sindy-agent`
  não são alvos de escrita nem de testes deste ciclo.

## Ciclo — o repositório seguindo a própria arquitetura

Sequência aprovada pelo Founder em 2026-10-17. Cada tarefa é uma mudança própria em
`docs/changes/`, deltaless, com PR e merge autorizado. O detalhe de cada uma vive na
proposta dela; os adiamentos que ela resolve estão em [DEFERRED.md](DEFERRED.md).

| Ordem | Entrega | Estado | Fecha |
|---|---|---|---|
| 1 | Adotar o próprio fluxo de mudança: archive e ledger de adiamentos | Integrada, PR #58 / v1.24.0, [proposta](changes/archive/2026-10-17-adotar-fluxo-de-mudanca/proposal.md) | — |
| 2 | Núcleo `shared` e utilitários de CLI | Integrada, PR #61 / v1.27.0, [proposta](changes/archive/2026-10-17-nucleo-shared-cli/proposal.md) | D-001 |
| 3 | Fronteira do Presence e `bench/` sem `tests/` | Integrada, PR #63 / v1.30.0, [proposta](changes/archive/2026-10-18-fronteira-presence/proposal.md) | D-002, D-003 |
| 4 | Módulos com entrada publicada e grafo acíclico | Integrada, PR #66 / v1.32.0, [proposta](changes/archive/2026-10-18-modulos-runtime/proposal.md) | D-004 |
| 5 | Fechamento como biblioteca: três CLIs e a persistência | Concluída: 5a `prepare-closure` (PR #67 / v1.34.0, [proposta](changes/archive/2026-10-18-fechamento-biblioteca-prepare/proposal.md)), 5b `state.mjs` (PR #69 / v1.36.0, [proposta](changes/archive/2026-10-18-fechamento-biblioteca-state/proposal.md)), 5c `post-merge.mjs` (PR #71 / v1.38.0, [proposta](changes/archive/2026-10-18-fechamento-biblioteca-post-merge/proposal.md)) e 5d, a camada única de persistência com a ordem de lock (PR #73 / v1.40.0, [proposta](changes/archive/2026-10-18-persistencia-unica/proposal.md)) | D-005, D-006, D-010 |
| 6 | Suíte mais rápida | Integrada, PR #74 / v1.41.0: de 71 s para 43 s, aceito pelo Founder como novo teto em 2026-10-19, [proposta](changes/archive/2026-10-18-suite-mais-rapida/proposal.md) | D-007 |
| 7 | Papéis deste repositório, extraídos do código | Integrada, PR #75 / v1.42.0, [proposta](changes/archive/2026-10-19-papeis-do-repositorio/proposal.md) | D-011 (registrado) |
| 8 | Tamanho do protocolo | Integrada, PR #76 / v1.43.0: `CLAUDE.md` de 86 KB para 45 KB, regra separada da justificativa, [proposta](changes/archive/2026-10-22-tamanho-do-protocolo/proposal.md) | D-008 |
| 9 | Tamanho dos cards do Solutions Architect e do Platform Engineer | Integrada, PR #77 / v1.44.0: Architect de 47 KB para 34 KB, Platform Engineer de 30 KB para 21 KB, [proposta](changes/archive/2026-10-22-tamanho-dos-cards/proposal.md) | — |
| 10 | Pass 1 com superfície e red provado na asserção | Integrada, PR #78 / v1.45.0, [proposta](changes/archive/2026-10-24-pass1-superficie/proposal.md) | — |
| 11 | Retro pós-merge: fechamento no próprio PR e primeira retro registrada | Integrada, PR #79 / v1.46.0: piloto em lote do #58 ao #78, [retros](retros/README.md), [proposta](changes/archive/2026-10-24-retro-pos-merge/proposal.md) | D-012, D-013 (registrados) |
| 11b | Retro pós-merge: coleta medida com `retro.mjs collect` | Integrada, PR #80 / v1.47.0, [proposta](changes/archive/2026-10-24-retro-coleta/proposal.md) | — |
| 12 | Gates de segurança na CI e piso do Node | Integrada, v1.48.0: audit e secret scan obrigatórios, vigilância diária, Node ≥ 22.23.4, [proposta](changes/archive/2026-10-24-seguranca-ci/proposal.md) | D-014, D-015 (registrados) |
| 11c | Retro pós-merge: o runtime cobra a retro depois do `closed` | Integrada, PR #82 / v1.49.0, [proposta](changes/archive/2026-10-24-retro-gatilho/proposal.md) | — |
| 12b | Vigilância de avisos e resposta a incidentes | Integrada, PR #83 / v1.50.0: skills `squad-security-watch` e `squad-incident-response`, lente red team do Quality Engineer, [proposta](changes/archive/2026-10-24-seguranca-resposta/proposal.md) | D-014 (entregue, aberto até o primeiro caso real) |
| 13 | Checagens julgadas de um relatório único e CI barata no consumidor | Integrada, v1.51.0: `verification.mjs checks`, regra da suíte única de volta ao §7, `consumer-ci.yml` só em PR e main, com cancelamento e namespace, [proposta](changes/archive/2026-10-24-checagens-por-relatorio/proposal.md) | — |
| 14 | Piso do Node nos projetos consumidores | Integrada, PR #85 / v1.52.0: `capabilities.mjs` relata `runtime.floor`, [proposta](changes/archive/2026-10-24-seguranca-piso-consumidor/proposal.md) | D-015 (entregue) |
| 15 | Documentação e log não invalidam a medição do código | Integrada, PR #86 / v1.53.0: `code_fingerprint` e `evidence.neutral_paths`, `.log/` neutro por padrão, [proposta](changes/archive/2026-10-24-evidencia-neutra/proposal.md) | — |
| 16 | Pass 2 só sobre o fechamento preparado | Integrada, PR #87 / v1.54.0: `pass2_complete` exige a preparação do fechamento que cobre o candidato, [proposta](changes/archive/2026-10-24-congelamento-antes-do-pass2/proposal.md) | — |
| 17 | Mutações em lote | Integrada, PR #88 / v1.55.0: um plano com `mutations` usa uma cópia, um setup e uma baseline, [proposta](changes/archive/2026-10-24-mutacoes-em-lote/proposal.md) | — |
| 18 | TAP aninhado do Vitest | Integrada, PR #89 / v1.56.0: resultado de grupo antes dos filhos, com chaves e tempo, lido como árvore, [proposta](changes/archive/2026-10-24-tap-vitest-aninhado/proposal.md) | — |
| 19 | Emenda de caminhos | Integrada, PR #90 / v1.57.0: `state.mjs amend-paths` amplia a posse com motivo na trilha e recusa módulo não nomeado, [proposta](changes/archive/2026-10-24-emenda-caminhos/proposal.md) | — |
| 20 | Baseline a partir de uma rodada de CI | Integrada, v1.58.0: `verification.mjs baseline <change> ci --from-run <id>` lê a rodada existente como `observed_ci_run`, [proposta](changes/archive/2026-10-24-baseline-rodada-ci/proposal.md) | — |
| 21 | Revisão independente nos PRs deste repositório | Integrada, v1.59.0: `REVIEW.md` na raiz, revisor em contexto limpo por head no `CONTRIBUTING.md` e no template de PR, provado sobre o diff do #76, [proposta](changes/archive/2026-10-25-revisao-independente/proposal.md) | D-016, D-017 (registrados) |
| 11d | Retro pós-merge: tendências e leitura do Architect | Integrada, v1.60.0: `retro.mjs trends` aponta achados recorrentes e quietos, o Solutions Architect os lê antes da proposta, e o item `retro-melhorias` abaixo, [proposta](changes/archive/2026-10-25-retro-tendencias/proposal.md) | — |
| 22 | Regras do #76 de volta ao núcleo | Integrada, v1.61.0: frases normativas perdidas de volta ao §7, `core_normative` no `check-plugin` visto recusando o #76, teto do núcleo em 49.152 bytes, [proposta](changes/archive/2026-10-25-regras-de-volta-ao-nucleo/proposal.md) | D-017 (entregue); D-018, D-019 (registrados) |
| 23 | Skills do squad fora do menu de slash | Integrada, v1.62.0: `user-invocable: false` nas skills `squad-*` geradas para o Claude Code, cobrado pelo `check-plugin`; só `/spectree:invoker` fica no menu, [proposta](changes/archive/2026-10-25-skills-fora-do-menu/proposal.md) | — |
| 24 | Painel do Invoker no Claude Code | Integrada, v1.63.0: `hooks/invoker-desk/` mostra a orquestração num painel lateral, o Invoker com seis orbs (Quas, Wex, Exort) que giram enquanto um subagente roda, custo, tokens e passos por subagente, [proposta](changes/archive/2026-10-25-painel-invoker/proposal.md) | — |
| 25 | Retrato do Invoker e tempo da sessão no painel | Integrada, v1.64.0: o avatar e os orbs pintados pelo Founder, nos cards e na órbita, e o tempo contado desde esta abertura da sessão, [proposta](changes/archive/2026-10-25-retrato-invoker/proposal.md) | — |
| 26 | Retrato e orbs em vetor no painel | Integrada, v1.65.0: o retrato e os orbs traçados em polígonos, porque o app desktop apaga `<image>` de um `Svg`, e o CI recusa bitmap ali, [proposta](changes/archive/2026-10-25-retrato-vetorial/proposal.md) | — |
| 27 | Cores dos orbs nos cards e sites nos passos | Integrada, v1.66.0: borda do card na cor do orb, faixas de Em execução (Quas) e Concluídos (Exort), e `Opening <site>` e `Searching: <busca>` nos passos de web, [proposta](changes/archive/2026-10-25-painel-cores-e-sites/proposal.md) | — |
| 28 | Card contido na borda e com o modelo do subagente | Integrada, v1.67.0: o card corta o que passa da borda, o avatar fica no lugar, e a linha do subagente diz tipo, modelo e esforço, [proposta](changes/archive/2026-10-25-painel-card-contido/proposal.md) | — |
| 29 | Passo em andamento no topo do card | Integrada, v1.68.0: o card em execução encabeça com o passo em andamento e Quas, Wex e Exort girando, [proposta](changes/archive/2026-10-25-painel-passo-em-andamento/proposal.md) | — |
| 30 | Execução do Claude Code com trailer `system` | Integrada, v1.69.0: o executor aceita eventos `system` (o `task_summary` do Claude Code 2.1.302) depois do único `result`, e o perfil `implement` pede a linha `spectree_result` sem condição, [proposta](changes/archive/2026-10-25-result-com-trailer-system/proposal.md) | — |
| 31 | Barra do plano no painel | Integrada, v1.70.0: a barra do plano em andamento, de Quas a Exort, substitui custo, tokens e tempo no painel, [proposta](changes/archive/2026-10-25-painel-plano/proposal.md) | — |
| 32 | Executor depois do fechamento preparado | Integrada, v1.71.0: as referências das tarefas seguem a pasta arquivada, e `repair` e `verify` aceitam a change em `implemented`, onde chegam os achados do pass 2, [proposta](changes/archive/2026-10-25-executor-pos-fechamento/proposal.md) | D-020, D-021 |
| 33 | Rodada incremental do pass 2 | Integrada, v1.72.0: `pass2.mjs record` e `scope` registram o que cada rodada atacou e dizem o que a seguinte ataca; evidência e `work.mjs finish` passam a medir duração e uso, [proposta](changes/archive/2026-10-25-pass2-incremental/proposal.md) | — |
| 34 | Harness do pass 2 | Integrada, v1.73.0: `setup_cache` na prova de mutação copia a instalação de uma entrada fora do checkout, com a baseline rodando sempre; `docs/reliability.md` mostra o banco por template, [proposta](changes/archive/2026-10-25-harness-pass2/proposal.md) | — |
| 35 | Contraexemplo concorrente no plano de verificação | Integrada, v1.74.0: o plano em desenho declara as regras de unicidade e de contador em `concurrent_invariants`, cada uma provada por um check com contraexemplo concorrente, [proposta](changes/archive/2026-10-25-contraexemplo-concorrente/proposal.md) | D-022 |
| 36 | Despacho do pass 2 com independência e escopo final | Integrada, v1.75.0: `work.mjs start --phase pass2` exige o brief com a independência e o escopo final, e `finish` recusa um escopo que mudou depois do início, [proposta](changes/archive/2026-10-25-despacho-pass2/proposal.md) | D-023 |
| 37 | Orçamento de contexto: menos chamadas por missão | Integrada, v1.76.0: no proposal a leitura obrigatória do despacho é teto para o Architect, e o pass 1 do Quality Engineer escreve e roda os testes em lote, [proposta](changes/archive/2026-10-26-orcamento-de-contexto/proposal.md) | D-024 |
| 38 | Plano próprio do Invoker no painel | Integrada, v1.77.0: a ferramenta `mcp__spectree__plan` e a instrução no prompt alimentam a barra do painel, com o título do plano, [proposta](changes/archive/2026-10-26-painel-plano-proprio/proposal.md) | — |
| 39 | Painel do Invoker em sessão longa | Integrada, v1.78.0: card concluído com a pintura pequena, os últimos 5 concluídos à vista e no máximo 50 guardados, [proposta](changes/archive/2026-10-26-painel-sessao-longa/proposal.md) | — |
| 40 | Desempenho do painel do Invoker | Integrada, v1.79.0: um passo escreve só o seu subagente, o relógio para sem nada rodando, quadro só no que se mexe e painel em recuperação no lugar do branco, [proposta](changes/archive/2026-10-27-painel-desempenho/proposal.md) | — |
| 41 | Chromium do Playwright detectado antes do baseline | Integrada, v1.80.0: `capabilities.mjs` lê do disco se o build Chromium que o Playwright do projeto pede está instalado, e o Platform Engineer o instala antes do baseline, [proposta](changes/archive/2026-10-27-navegador-detectado/proposal.md) | D-025 |
| 42 | Painel do Invoker mais limpo | Integrada, v1.81.0: sem a linha verde da contagem de subagentes, e o plano sem moldura, com o título na cor do texto, [proposta](changes/archive/2026-10-27-painel-limpo/proposal.md) | — |
| 43 | Painel do Invoker sóbrio | Integrada, v1.82.0: cards com moldura na cor do texto apagado e sem barra de progresso, e a seção Concluídos no verde de concluído, [proposta](changes/archive/2026-10-27-painel-sobrio/proposal.md) | — |
| 44 | Barra do plano no terminal | Integrada, v1.83.0: o plano acima do prompt no terminal, em blocos no degradê dos orbes, e a barra do painel com faíscas, brilho e a tarefa em andamento acesa, [proposta](changes/archive/2026-10-28-barra-plano-terminal/proposal.md) | — |
| 45 | Painel do Invoker no rebrand da Spectree | Integrada, v1.84.0: o mascote no centro sem os orbs, o especialista que trabalha no lugar dele, cards com o mascote pequeno e a paleta Void, Surface, Mist, Spirit e Depth, [proposta](changes/archive/2026-10-28-rebrand-mascote/proposal.md) | — |
| 46 | Avatar principal espectral | Integrada, v1.85.0: o centro visto como se por outra dimensão, com o ar ondulando, dois fantasmas em Spirit e Depth fora de fase e um flicker, [proposta](changes/archive/2026-10-29-avatar-espectral/proposal.md) | — |
| 47 | Inventário do executor sem os registros de processo | Integrada, v1.86.0: `tasks.mjs run` deixa de quebrar com `ENOBUFS` quando `.spectree/processes` passa de 1 MiB, e a listagem do candidato fica 16 vezes mais rápida, [proposta](changes/archive/2026-10-29-inventario-sem-processos/proposal.md) | D-026 (registrado) |
| 48 | Cota lida só do que é estruturado no executor | Integrada, v1.87.0: a declaração `spectree_result` vale no fim da mensagem final, com prosa antes, e a cota só vem das falhas do harness ou de uma declaração `interrupted`, nunca da saída de ferramenta, [proposta](changes/archive/2026-10-29-executor-cota-estruturada/proposal.md) | — |

## Itens com aprovação permanente

Uma mudança que cabe inteira num item abaixo tem o escopo aprovado pela decisão já tomada (gate 1 por
política, Seção 8 do protocolo). O merge continua pedindo a autorização do Founder no PR.

- **`retro-melhorias`** · policy: scope · aprovado pelo Founder em 2026-10-25, no GO da tarefa 11d.
  Cabe aqui uma mudança deltaless que paga um achado que `retro.mjs trends` lista como recorrente, ou
  fecha um que lista como quieto, sem criar módulo, sem afrouxar regra ou check e sem passo
  irreversível. Qualquer dúvida sobre esses três pontos, e é gate 1 comum.

## Histórico de decisões

- **2026-10-29:** Founder autorizou a série da retro do SYND (tarefas 48 a 50): cota estruturada no executor, guardas de abertura e do pass 2, regra multi-caminho no Architect.
- **2026-10-29:** Founder autorizou a correção do `ENOBUFS` no inventário do executor, que travava o fechamento da C3e no SYND (tarefa 47).
- **2026-10-29:** Founder pediu um motion espectral no avatar principal, como se visto em outra dimensão (tarefa 46).
- **2026-10-28:** Founder trocou a identidade do painel para o rebrand da Spectree (tarefa 45): mascote no lugar do Invoker, especialista no lugar do mascote enquanto trabalha, paleta nova.
- **2026-10-28:** Founder pediu a barra do plano no CLI e no estilo do Helper Desk (tarefa 44).
- **2026-10-27:** Founder pediu o painel ainda mais sóbrio (tarefa 43): cards em cinza, sem barra de progresso, Concluídos em verde.
- **2026-10-27:** Founder pediu o painel mais limpo (tarefa 42): sem a contagem verde e sem a moldura do plano.
- **2026-10-27:** Founder deu GO na tarefa 41, a terceira proposta dos desvios da retro da change passkeys
  do SYND: o Chromium do Playwright detectado antes do baseline.
- **2026-10-27:** Founder autorizou a tarefa 40 a partir do levantamento de performance do painel.
- **2026-10-26:** Founder relatou o painel sem desenho numa sessão longa; a tarefa 39 corrige pelo mesmo
  pedido, sem cartão, por ser defeito do painel que ele já aprovou.
- **2026-10-26:** Founder escolheu o plano próprio do Invoker (tarefa 38) no lugar de seguir o do Helper
  Desk, que ele desliga.
- **2026-10-26:** Founder autorizou a tarefa 37, a partir da discovery de custo de tokens dos subagentes,
  só com as regras que cortam chamadas sem deixar o pipeline mais lento; a segmentação de missões ficou no D-024.
- **2026-10-25:** Founder autorizou as tarefas 35 e 36, nessa ordem e depois da série 32 a 34, a partir
  dos desvios da retro da change passkeys do SYND: contraexemplo concorrente no plano e despacho do pass 2.
- **2026-10-25:** Founder autorizou as tarefas 32 a 34 em série, a partir do relatório do Invoker do SYND
  sobre o tempo do pass 2: executor depois do fechamento, rodada incremental do pass 2 e harness do plugin.
- **2026-10-25:** Founder pediu a tarefa 31: a barra do plano em andamento no painel, no lugar de custo,
  tokens e tempo.
- **2026-10-25:** Founder autorizou a tarefa 30, a partir do bug que o Invoker relatou no SYND: toda
  execução do Claude Code 2.1.302 virava `unknown` pelo `task_summary` depois do `result`.
- **2026-10-25:** Founder pediu a tarefa 29 ao comparar o card com o Helper Desk: o passo em andamento
  no topo, com um indicador girando no DNA do Invoker.
- **2026-10-25:** Founder pediu a tarefa 28 ao ver no v1.66.0 um passo longo passar da borda do card
  e empurrar o avatar para fora, e o tipo, o modelo e o esforço do subagente no card, como o Helper Desk.
- **2026-10-25:** Founder pediu a tarefa 27 ao comparar o painel com o Helper Desk: borda na cor do orb,
  faixas coloridas nas seções e o site aberto em cada WebFetch.
- **2026-10-25:** Founder pediu a tarefa 26 ao ver o v1.64.0 no app desktop sem o retrato e sem as
  pinturas dos orbs: as imagens passam a ser vetor traçado.
- **2026-10-25:** Founder autorizou a tarefa 25: um avatar próprio, gerado por ele, vira o retrato do
  painel no lugar de uma arte de terceiros, e o tempo passa a contar desde esta abertura.
- **2026-10-25:** Founder autorizou a tarefa 24: o painel do Invoker entra no plugin principal, não
  como plugin separado, aceitando a dependência dos function hooks em early access.
- **2026-10-25:** Founder autorizou a tarefa 23: as skills do squad saem do menu `/` dele, e só
  `/spectree:invoker` fica visível.
- **2026-10-25:** Founder autorizou a tarefa 22, o D-017: as regras que o #76 deixou só na justificativa
  voltam ao núcleo, e o `check-plugin` passa a listar cada frase normativa. Inclui D-018 e D-019 como gatilhos.
- **2026-10-25:** Founder autorizou a tarefa 11d: `retro.mjs trends`, a leitura das tendências pelo
  Solutions Architect antes da proposta e o item permanente `retro-melhorias` com `policy: scope`.
- **2026-10-25:** Founder autorizou a tarefa 21, a lacuna 1 do discovery do `REVIEW.md`: todo PR
  deste repositório passa por um revisor em contexto limpo. A lacuna 2, integração por política de
  risco, fica no D-016 até a decisão dele.
- **2026-10-24:** Founder autorizou os itens 3 a 8 da análise do custo de verificação do SYND C3a,
  como as tarefas 15 a 20, uma mudança por item, na ordem da análise.
- **2026-10-24:** Founder autorizou a tarefa 14: o consumidor fica sabendo, pelo relatório de
  capacidades, quando roda o squad num Node abaixo do piso de segurança.
- **2026-10-24:** Founder autorizou a tarefa 13, itens 1 e 2 da análise do custo de verificação
  do SYND C3a: checagens julgadas de uma execução da suíte e template de CI barato no consumidor.
- **2026-10-24:** Founder autorizou a tarefa 12b: o blue team continua sendo processo, com a
  vigilância de avisos no Integration Engineer e a resposta a incidentes no Platform Engineer.
- **2026-10-24:** Founder autorizou a tarefa 11c: o planner aponta a retro depois do `closed`
  e `state.mjs open` recusa a próxima mudança com `E_RETRO_PENDING` até ela ser registrada.
- **2026-10-24:** Founder autorizou a tarefa 12, a primeira entrega da frente de segurança:
  audit e secret scan na CI deste repositório e piso do Node nas versões corrigidas em 2026-10-21.
- **2026-10-24:** Founder autorizou a tarefa 11b: a coleta da retro sai de um comando,
  `retro.mjs collect`, e não de leitura manual.
- **2026-10-24:** Founder autorizou a tarefa 11, a primeira entrega da retro pós-merge:
  o fechamento passa a viajar no próprio PR, e as retros ficam em `docs/retros/`.
- **2026-10-24:** Founder autorizou a tarefa 10: oficializar o passo de superfície antes da pass 1,
  registrar a pass 1 inteira numa execução só e aceitar só red que chegou à asserção.
- **2026-10-22:** Founder pediu a tarefa 9, o mesmo corte de regra e justificativa nos cards
  do Solutions Architect e do Platform Engineer.
- **2026-10-17:** Founder aprovou a sequência de modularização do repositório
  (tarefas 1 a 8 acima). A tarefa 1 arquiva as mudanças integradas e cria o ledger
  de adiamentos.
- **2026-10-17:** o PR #54 entrou durante a preparação P4.1, avançando a main
  para `5d9f7c4` / 1.20.0. Publicação bloqueada antes do push; nova incorporação
  por merge `746c852`, com conflitos apenas de versão nos três manifestos,
  resolvidos mantendo **1.21.0**. Gerados conferidos por build; `npm ci` e nova
  validação sobre essa base: **507/507 testes**, zero falhas ou skips. Base e
  versão reconsultadas após a suíte, antes do PR e sem merge na main.
- **2026-10-17:** preparação P4.1 contra `origin/main` em `ac7fd7d`, incluindo
  PRs #49–#53, por merge sem conflitos textuais. Preparação inicial **1.20.0**; `npm ci`
  seguido de `npm run check`: **506/506 testes**, zero falhas ou skips. Nenhuma
  lib adicionada a `RUNTIME_LIBS`; auditoria do runtime sem import de UI e teste
  5e2 aprovados. O PR #54 passou a reservar 1.20.0 durante a validação: candidata
  elevada para **1.21.0**, com nova revalidação limpa antes da publicação por PR.
  Decisão de merge reservada ao Founder.
- **2026-10-17:** Founder autorizou implementar P4.1 com registro completo dos
  seis papéis desde o início. Branch `codex/presence-p4-delegation`; backend
  textual opt-in, sem chamadas de áudio ou acesso a consumidores. Entrega
  mantém os limites de consulta; `npm run check` aprovado com **498/498 testes**,
  incluindo 29 novos de P4.1. RPC simulado e HTTP local; interface, voz,
  compatibilidade real dos novos perfis e merge não são declarados prontos.
- **2026-10-17:** Founder corrigiu o escopo P4: delegação para qualquer subagente
  elegível, não apenas Architect. Planejamento passa a prever registro dos seis
  papéis, ferramenta genérica e identidade por instância desde P4.1. Architect
  é apenas o primeiro canário; demais papéis pertencem ao mesmo ciclo.
- **2026-10-17:** após o merge, Founder aprovou iniciar o planejamento P4.
  Branch `codex/presence-p4-planning`, base `8c7b099` / v1.16.0. Definidos
  contrato de delegação, autoria, fila de fala, cancelamento e critérios de aceite
  para Invoker e Architect em canário isolado. Nenhum novo ensaio pago.
- **2026-10-17:** P3-R integrada pelo PR #48 em `8c7b099`; tag v1.16.0
  confirmada nesse commit. Candidata com 469/469 testes Windows e conteúdo
  idêntico ao merge; CI da main e publicação da tag concluídas com sucesso.
- **2026-10-17:** Founder aprovou a recomendação de merge. Preparação da versão
  1.16.0, incorporando `origin/main` em `104f709` para preservar escrita atômica
  no Windows, digest CRLF e remoção de dados pessoais. O aceite da interface e
  as correções P2 permanecem; integração e tag dependem do PR e seus workflows.
- **2026-10-17:** correções dos dois P2 concluídas, com seis regressões novas e
  **467/467 testes** em `npm run check`, incluindo integridade e drift. Revisão
  das correções não encontrou outro bloqueio no escopo analisado. Recomendado
  seguir para o merge da P3-R; autorização de merge continua pendente.
- **2026-10-16:** após revisão, Founder autorizou corrigir dois achados P2 da
  P3-R: análise Codex sobrevivendo à interrupção/timeout e confirmação de hangup
  antiga atingindo outra chamada. Correções e seis regressões implementadas;
  71 testes Presence aprovados. Regressão completa em verificação. Orçamento
  preservado, sem chamadas pagas adicionais e sem autorização de merge inferida.
- **2026-10-16:** Founder confirmou que a experiência Realtime funcionou
  perfeitamente. Aceite P3-R registrado; merge ainda depende de autorização
  própria. Ensaio atingiu o limite previsto de 60 s e teve hangup confirmado.
  Reservas conhecidas US$ 5,30 de US$ 6; saldo conservador US$ 0,70, sem extrato.
- **2026-10-16:** Founder ampliou explicitamente o teto total dos ensaios para
  **US$ 6**, liberando outro ensaio Realtime de 60 s. Reservas conhecidas US$ 4,30;
  saldo conservador US$ 1,70, sem consulta ao extrato. Realtek abriu corretamente
  na verificação local; correções de preparação/seleção validadas por 65 testes
  Presence. Aceite da conversa física completa e merge continuam pendentes.
- **2026-10-16:** Founder escolheu voz nativa Realtime conduzindo a conversa e
  Codex pela assinatura para análises/trabalho; implementação em
  `codex/presence-realtime`. Teto dos ensaios elevado para US$ 5. Canário real
  validou streaming, energia de áudio, interrupção e retorno Codex falado.
  Saldo conservador de reserva US$ 1,70; extrato não consultado. Neste incremento
  a ponte continua conversacional, sem execução em projetos ou especialistas.
- **2026-10-16:** Founder confirmou que os testes de áudio funcionaram e
  esclareceu que o objetivo é interação Realtime. P3 passa a ser tratada como
  fundação de áudio; P3-R deve entregar conversa contínua antes de P4. Solicitada
  decisão sobre autoria da conversa (voz nativa com ponte Codex ou Codex em cada
  resposta), pois as alternativas têm latência e consumo de API diferentes.
- **2026-10-16:** chave local validada; canários reais de API e captura via
  AudioWorklet transcreveram fala conhecida. 50 testes da Presence passaram.
  Founder confirmou reprodução de resposta por texto e relatou `E_TRANSCRIPT`
  com pouca reação à entrada física. Adicionados seletor de microfone, medidor
  e reprodução local para concluir esse diagnóstico e o aceite. Reserva
  conservadora restante do ensaio: US$ 1,30; valor faturado não consultado.
- **2026-10-16:** recuperado o resultado da regressão final P3: 440/440 testes.
  Implementação e documentação prontas para revisão na branch; chave OpenAI
  ainda ausente. Ensaio pago não executado, gasto de áudio zero; merge pendente.
- **2026-10-15:** GO para P3, branch `codex/presence-voz-invoker`, a partir do
  merge `87c6bc1` / v1.15.0. Founder escolheu OpenAI, até US$ 2 no ensaio.
  O primeiro incremento usa captura explícita e texto concluído antes da síntese;
  full duplex e inferência de emoção não fazem parte desta entrega.
- **2026-10-15:** merge da P2 autorizado pelo Founder. Incorporado o README da
  main / 1.14.1 e preparado o pacote 1.15.0. A confirmação de integração e da
  publicação pertence ao PR e ao workflow do commit de merge.
- **2026-10-15:** concluída a validação da P2 nesta branch, com conversa real,
  contexto preservado, interrupção confirmada e verificação da interface.
  A entrega permanece separada de main, aguardando revisão e autorização de merge.
- **2026-10-14:** GO para P2 após merge da P1. Aberta `codex/presence-sessao-codex`;
  validado canário real de texto, continuidade e interrupção com Codex local.
  A versão do pacote permanece 1.14.0; nenhuma voz ou execução do squad é alegada.
- **2026-10-14:** complementada a P1 com reconstrução da sessão ao restaurar a
  página, fallback gráfico e testes de movimento reduzido e descarte de recursos.
  Evidências e limites constam no registro de verificação; integração real permanece em P2.
- **2026-10-14:** iniciada e implementada a fundação P1 após GO do Founder. O comando
  `npm run presence` abre uma superfície de demonstração isolada dos consumidores;
  a versão do pacote permanece 1.13.0 até a preparação de uma release.
- **2026-10-13:** registrada a aprovação da direção visual e aberta a branch
  `codex/presence-fundacao`. A fundação precede a integração para preservar o
  visual aprovado e definir estados cuja origem possa ser comprovada. O número
  1.14 identifica o ciclo planejado; a versão publicada permanece 1.13.0.
