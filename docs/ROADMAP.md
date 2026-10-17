# Roadmap do Spectree Invoker

Atualizado em 2026-10-16. Este documento registra a ordem aprovada e seus motivos.
O escopo e os critérios de cada entrega pertencem à respectiva proposta de mudança;
esta sequência não representa funcionalidades já disponíveis nem compromissos de data.

## Base entregue

O pacote **1.14.0 — Fundação Presence** foi integrado, com a demonstração
visual P1. O runtime mantém os gates, a execução resiliente e as evidências da
1.13.0. A [Console](console.md) oferece observabilidade local somente para leitura.
A entrega **1.15.0 — Sessão Presence Codex** acrescenta integração textual local
com o harness (P2). Conversa por voz permanece na P3.

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
| P1 | Fundação visual e contrato de estados | Integrada em main, PR #41 / v1.14.0 | Componente Three.js local, áudio demonstrativo analisado e estados determinísticos. [Uso](presence.md), [proposta](changes/presence-fundacao/proposal.md) e [verificação e limites](changes/presence-fundacao/verification.md). |
| P2 | Sessão local e integração Codex | Integrada em main, PR #43 / v1.15.0 | Texto e eventos por app-server/stdio, autenticação local ChatGPT, thread efêmera sem ambientes, resposta incremental e interrupção. [Uso](presence-codex.md), [proposta](changes/presence-sessao-codex/proposal.md) e [verificação](changes/presence-sessao-codex/verification.md). |
| P3 | Fundação de áudio do Invoker | Implementada em branch; Founder confirmou funcionamento dos testes; 53 testes Presence passaram | Captura explícita, transcrição revisável, síntese e seleção de microfone. [Uso](presence-voice.md), [proposta](changes/presence-voz-invoker/proposal.md) e [verificação](changes/presence-voz-invoker/verification.md). Esta interação por gravações ainda não atende à conversa contínua desejada. |
| P3-R | Conversa Realtime com o Invoker | Aceita pelo Founder em 2026-10-16; merge pendente | WebRTC, áudio em streaming, turnos automáticos, interrupção pela fala e consulta Codex confirmada. Canário nativo e ensaio do Founder com microfone físico validados. [Uso](presence-realtime.md), [proposta](changes/presence-realtime/proposal.md) e [verificação](changes/presence-realtime/verification.md). Prioridade antes dos especialistas. |
| P4 | Comunicação entre Invoker e especialista | Planejada | Começar com Invoker e Architect: delegação real, identidade do falante e retorno público audível. Expandir aos demais papéis após validar atribuição, fila de fala e legibilidade. |
| P5 | Continuidade e recuperação da experiência | Planejada | Endurecer reconexão, retomada, interrupção pelo usuário e prevenção de ações ou falas duplicadas. Os mecanismos básicos de cancelamento e limpeza já são exigidos desde a etapa que os introduz. |
| P6 | Canário e preparação da entrega | Planejada | Validar a jornada completa em projeto descartável: compatibilidade com gates, acessibilidade, desempenho, instalação e custo observado. Consolidar evidências e instruções operacionais antes de recomendar merge/release. |

## Decisões que orientam a sequência

- O primeiro harness será o Codex. O suporte conversacional ao Claude fica para
  uma entrega posterior, sem alterar o suporte existente do plugin ao Claude Code.
- A intenção é utilizar a assinatura do usuário pela autenticação oficial do
  harness. A compatibilidade do transporte será verificada em P2; APIs de áudio
  têm contratação e orçamento próprios. Para P3, OpenAI foi aprovada até US$ 2
  no ensaio, com configuração de chave local necessária.
- Um coordenador local de sessão fará a ponte entre interface, harness e áudio.
  A interface não recebe credenciais de longa duração nem acesso arbitrário ao disco.
- A fala entre agentes apresenta delegações, progresso e resultados públicos.
  Ela não reproduz raciocínio interno, nem transforma animação em evidência de execução.
- O runtime continua sendo a autoridade sobre gates e ações. Uma animação ou
  resposta falada não concede aprovação; comandos com efeito precisam passar
  pelo fluxo de autorização aplicável.
- Testes de integração usam apenas canários. `spectree-workspace` e `sindy-agent`
  não são alvos de escrita nem de testes deste ciclo.

## Histórico de decisões

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
