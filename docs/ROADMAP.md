# Roadmap do Spectree Invoker

Atualizado em 2026-10-17. Este documento registra a ordem aprovada e seus motivos.
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
| 5 | Fechamento como biblioteca, em três PRs | Em andamento: 5a `prepare-closure`, [proposta](changes/fechamento-biblioteca-prepare/proposal.md); depois `state.mjs` e `post-merge.mjs` | D-005, D-006, D-010 |
| 6 | Suíte mais rápida | Planejada, depois da 5 | D-007 |
| 7 | Papéis deste repositório, extraídos do código | Planejada, depois da 4 | — |
| 8 | Tamanho do protocolo | Aguarda decisão de produto do Founder | D-008 |

## Histórico de decisões

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
