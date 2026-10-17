# Presence P3 — voz do Invoker

GO do Founder em 2026-10-15; branch `codex/presence-voz-invoker`, a partir da
P2 integrada no PR #43 / v1.15.0. OpenAI autorizada para o ensaio, até US$ 2.
Sem autorização de merge desta etapa. Consumidores não são alvos de teste.

## Arquitetura e primeira entrega

Microfone → WAV local → transcrição → texto revisável → sessão Codex P2 →
resposta concluída → síntese de voz → Web Audio → personagem aprovado.
O Codex mantém a autoria da resposta pela assinatura. A API de áudio tem chave
própria no servidor e cobrança separada. Não há outro agente respondendo no lugar
do Invoker. A voz é identificada como sintética.

O primeiro incremento usa gravação explícita de até 45 s, revisão antes de enviar,
e reprodução automática opcional das novas respostas concluídas. A fala pode ser
interrompida imediatamente. A captura não fica aberta enquanto o Invoker fala;
não se promete full duplex, detecção de emoção ou latência de Realtime nesta P3.
O atraso até a resposta do Codex e o tempo de síntese são medidos separadamente.

API inicial: gpt-4o-mini-transcribe e gpt-4o-mini-tts, voz marin. O adaptador é
substituível. A escolha usa o contrato documentado; qualidade em português e
latência real ainda exigem ensaio, não são inferidas de publicidade.

## Fronteiras

- Voz opt-in no CLI; P1 e P2 permanecem utilizáveis sem API de áudio.
- Chave via OPENAI_API_KEY, nunca por URL, navegador, log, arquivo versionado ou chat.
- HTTP autenticado e mesma origem; WAV validado no servidor, tamanhos e duração
  limitados. A síntese aceita identidade/trecho de uma resposta pública concluída,
  não texto arbitrário fornecido pelo navegador.
- Uma operação de áudio por vez; IDs consumidos antes da chamada; sem retries
  automáticos. Abort em cancelamento, mudança de sessão, novo turno e fechamento.
- Reserva conservadora de US$ 0,10 por chamada, no máximo US$ 2 por processo no
  ensaio. É controle local de chamadas, não extrato nem garantia da cobrança do
  fornecedor. Custos incertos não são estornados para permitir novas chamadas.
- Captura e áudio permanecem em memória; nenhuma persistência de gravações.
- Permissão de microfone só por ação explícita. O teste automatizado usa áudio
  sintético e nunca liga o microfone físico por conta própria.
- Intensidade visual medida da saída de áudio; transcrever/processar não é falar.

## Aceite

1. Transcrição revisável e envio único ao Codex; falhas preservam o texto digitado.
2. Resposta pública sintetizada com atribuição ao Invoker e RMS medido.
3. Cancelamento descarta respostas atrasadas, para reprodução e libera microfone.
4. Falhas de permissão, rede, orçamento e autoplay não causam reenvio ou fala duplicada.
5. Testes determinísticos de fronteiras e regressão P1/P2; ensaio real condicionado
   à chave local e ao teto aprovado. Relatar separadamente o que não foi medido.

Fontes consultadas em 2026-10-15:
- https://developers.openai.com/api/docs/guides/text-to-speech
- https://developers.openai.com/api/reference/resources/audio/subresources/transcriptions/methods/create
- https://developers.openai.com/api/docs/pricing
