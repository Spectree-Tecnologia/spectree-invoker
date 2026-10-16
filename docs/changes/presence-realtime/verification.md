# Verificação — Presence Realtime

2026-10-16 · branch `codex/presence-realtime`, baseada na P3 ainda não integrada.
Founder confirmou a base manual e escolheu voz nativa Realtime com ponte Codex.
Autorizou elevar o teto total dos ensaios OpenAI de US$ 2 para US$ 5.
Não há autorização de merge desta entrega.

## Implementação

WebRTC contínuo, bootstrap pelo servidor, gpt-realtime-2.1, voz marin, semantic
VAD, interrupção de fala, playout nativo com RMS, legendas públicas e ponte
`consultar_codex` via app-server autenticado. A ponte permanece em canário
isolado e conversacional. Nenhum consumidor foi usado como alvo.

Controles de conversa, seleção do notebook, descarte de resultados antigos,
deduplicação de função, limites de tempo/contexto/saída e encerramento pelo
servidor. Dependência `ws` fixada em 8.22.0, instalada sem scripts; npm reportou
zero vulnerabilidades na instalação. Isso não é auditoria de segurança completa.

## Canários reais

1. Conexão e deadline: WebRTC/sideband abertos; uma corrida na fixture impediu
   iniciar sua mídia. O servidor encerrou aos 60 s, com hangup confirmado e zero
   tokens observados. Cliente corrigido para esperar o canal RTC abrir.
2. Canário de 15 s: resposta nativa e análise iniciadas, interrompidas pelo
   limite antes do resultado. 559 tokens de entrada e 238 de saída observados.
   Não creditado como validação da análise concluída ou RMS audível.
3. Canário completo, após ajuste de playout: fala demonstrativa sem microfone
   físico; resposta nativa com **energia máxima 1,0000**. Nova fala durante a
   saída produziu **uma interrupção observada**. A consulta Codex concluiu; o
   Invoker falou dois critérios de aceite para uma lista de tarefas e voltou a
   escutar. Uso observado: **2.846 tokens de entrada e 871 de saída**. Botão
   encerrou os dispositivos. Ajustado o fechamento para manter o controle até
   hangup e distinguir recurso já encerrado de confirmação ausente.
4. Canário final de fechamento, 15 s: encerramento local seguido de estado remoto
   **already-ended**; zero tokens observados. Nenhuma nova chamada após esse teste.

Captura `presence-realtime-canary.png` nos artefatos desta conversa registra
energia, interrupção e análise confirmada. Dados sintéticos; nenhum microfone
físico foi ligado. O Founder validou seu microfone no modo manual anterior.

Reservas Realtime: US$ 1 + US$ 0,30 + US$ 1 + US$ 0,30 = **US$ 2,60**. Somadas
às reservas conhecidas anteriores US$ 0,70: **US$ 3,30**, saldo conservador
**US$ 1,70** do teto US$ 5. Sem consulta ao extrato ou afirmação de custo faturado.

## Testes

**62/62 testes Presence passaram**, incluindo nove Realtime: configuração,
segredo isolado, orçamento/deduplicação/cancelamento, execução única da ponte,
invalidação por fala, deadline sem cliente, full duplex/interrupção, readiness
RTC, permissão tardia e HTTP autenticado. Nenhum usa a API paga.

A primeira suíte ampla teve **455/456 passando**; o benchmark recusou medição
mista porque o pacote estava sendo editado durante a execução. Essa proteção
não foi desabilitada. A primeira execução não é creditada como verde.

Repetição final com árvore estável: **`npm run check` aprovado, 458/458 testes**,
zero falhas, cancelamentos ou skips, em 333.214 ms. `check:drift` e
`check:plugin` também aprovados. Depois da suíte, apenas este registro de
evidência foi atualizado; nenhum código mudou.

Interface operacional conectada ao Codex local e pronta para **Iniciar
conversa**, com reserva US$ 0 / US$ 1,70. Captura
`presence-realtime-ready.png` nos artefatos desta conversa. Nenhuma chamada paga
foi iniciada nessa interface. Servidores e abas temporários dos canários foram
encerrados. `.env` ignorado e não rastreado pelo Git.

## Pendências

Aceite Realtime com o microfone físico do Founder, latência percebida em conversa
prolongada e matriz de dispositivos/navegadores. Sessões de 60 s são ensaios, não
configuração de produção. Execução em projetos e especialistas ficam nas etapas
posteriores. Nenhum merge realizado.
