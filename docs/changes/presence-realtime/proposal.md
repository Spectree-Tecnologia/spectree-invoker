# Presence Realtime — conversa contínua

Requisito esclarecido pelo Founder em 2026-10-16: os testes do primeiro áudio
funcionaram, mas gravar/concluir/revisar/enviar não é a experiência desejada.
O objetivo é conversar naturalmente com o Invoker em tempo real. Implementação
na branch `codex/presence-realtime`; evidências na [verificação](verification.md).

## Experiência de aceite

1. Escolher o microfone do notebook, clicar uma vez em **Iniciar conversa** e
   falar sem precisar concluir gravações ou enviar transcrições manualmente.
2. Receber fala conforme o áudio é produzido, sem esperar um arquivo inteiro.
3. Começar a falar durante a resposta: a saída audível deve parar e a nova fala
   deve ser recebida. Limpar áudio enfileirado e invalidar resultados antigos.
4. Detectar automaticamente início/fim da fala, tolerando pausas naturais.
5. Oferecer **Silenciar microfone** e **Encerrar conversa**; erro, fechamento
   ou encerramento devem liberar dispositivos e conexões.
6. Preservar atribuição da fala, animação por áudio real e legendas públicas.
7. Não repetir turnos ou trabalho após queda de conexão. Medir tempo até primeiro
   áudio, interrupção audível e perda/duplicação de turnos no canário.

O sucesso dos testes P3 de gravação valida componentes de áudio e configuração,
mas não atende a estes critérios de conversa contínua.

## Decisão de arquitetura aprovada

A preferência foi solicitada ao Founder, pois altera quem formula a conversa.
Ele escolheu **voz nativa Realtime com ponte Codex** em 2026-10-16:

- **Voz nativa Realtime com ponte Codex:** modelo de áudio conduz a interação
  imediata; análises e trabalho são encaminhados ao Codex pela autenticação da
  assinatura. A conversa de voz passa a consumir inferência por API, além do
  áudio. O modelo de voz não deve alegar trabalho ou consultas não confirmados.
- **Codex em cada resposta:** transcrição contínua alimenta o app-server e sua
  resposta pública alimenta síntese incremental. Mantém autoria integral do
  Codex, com sua latência de geração no caminho de todas as respostas. Não é
  equivalente a uma sessão nativa speech-to-speech.

A primeira alternativa orienta a implementação. A segunda é a alternativa não
escolhida; a P3 manual permanece disponível pelo argumento `--voice`.

## Base técnica proposta para voz nativa

- WebRTC para mídia contínua entre navegador e OpenAI; bootstrap autenticado no
  servidor local via `/v1/realtime/calls`, com chave permanente só no servidor.
- Detecção de turnos e interrupção da Realtime API; identidade de sessão/turno
  para impedir retorno tardio de análises e retomada de fala já interrompida.
- Canal de controle no servidor para ferramentas e ponte Codex. O cliente não
  é autoridade sobre aprovações, identidade de chamadas ou conclusão de trabalho.
- Uma única execução por chamada de ferramenta, validada e correlacionada. O
  primeiro incremento continua em canário conversacional, sem abrir projetos.
- Preservar cancelamento confirmado do app-server; interromper a fala não
  implica afirmar que o trabalho do Codex já terminou ou foi cancelado.
- Só atos/retornos públicos alimentam fala. Nenhuma projeção de raciocínio interno.

## Orçamento e implementação

O Founder elevou o teto total dos ensaios de US$ 2 para **US$ 5** durante a
implementação. Reservas conhecidas e saldo restante estão na verificação;
não se confundem com o valor faturado.

A reserva P3 de US$ 0,10 por pedido de arquivo não deve ser apresentada como um
limite financeiro de uma conexão Realtime. Os ensaios usam modelo fixo, tempo
máximo, limites de contexto/saída, reserva por sessão, uso observado e
encerramento pelo servidor. Não reiniciar contadores para ampliar o teto.

Sequência: fechar papel do Codex → implementar conexão/encerramento → turnos e
interrupção → ponte com Codex → canário sintético → ensaio real limitado →
aceite do Founder. Medições e limites estão na verificação; ainda não há
autorização de merge nesta proposta.

Fontes oficiais consultadas em 2026-10-16:

- [WebRTC](https://developers.openai.com/api/docs/guides/voice-webrtc?voice-api=realtime)
- [Conversas Realtime](https://developers.openai.com/api/docs/guides/realtime-conversations)
- [Detecção de fala](https://developers.openai.com/api/docs/guides/realtime-vad)
- [Controle no servidor](https://developers.openai.com/api/docs/guides/voice-server-controls?voice-api=realtime)
- [Transcrição contínua](https://developers.openai.com/api/docs/guides/realtime-transcription)
