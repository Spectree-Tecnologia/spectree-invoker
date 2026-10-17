# Presence Realtime

Conversa contínua com áudio nativo OpenAI Realtime e ponte de análise para o
Codex local. Escolha aprovada pelo Founder em 2026-10-16. Incluída na versão
1.16.0 do Spectree Presence.
Experiência aceita pelo Founder em 2026-10-16 após o ensaio com microfone físico.

## Usar

Na raiz do spectree-invoker, com dependências instaladas, login ChatGPT no Codex
e `.env` configurado com `OPENAI_API_KEY` e, se necessário,
`SPECTREE_CODEX_EXECUTABLE`:

```powershell
node --env-file=.env scripts/presence.mjs --codex --realtime --budget-usd 0.7
```

Abra a URL completa impressa. Conecte o Codex, use **Escolher microfone** para
selecionar o integrado do notebook e clique em **Iniciar conversa**. Espere a
conexão ficar pronta e fale normalmente. Não há gravação/conclusão/envio manual
de transcrição nesse modo. A voz detecta automaticamente os turnos e recebe
nova fala durante a resposta. **Silenciar microfone** interrompe a entrada;
**Encerrar conversa** para a mídia e solicita encerramento remoto. Ocultar ou
fechar a página também encerra a conversa.

O Founder ampliou explicitamente o teto total para US$ 6 em 2026-10-16 e validou
o ensaio seguinte. As reservas conhecidas passaram a US$ 5,30. O comando acima
preserva o saldo US$ 0,70 e permite configurar o microfone, mas bloqueia outro
ensaio de US$ 1. Novos ensaios pagos exigem orçamento adicional autorizado;
reiniciar o processo não estorna as reservas anteriores.

Se ocorrer `E_MIC_PERMISSION` ao escolher o microfone, selecione o Realtek na
lista e clique novamente em **Escolher microfone**. Com uma entrada explícita,
essa ação verifica a abertura dela e para imediatamente as trilhas, sem criar
gravação ou pedido de áudio. Listar nomes de dispositivos não comprova acesso
de captura. Uma recusa do navegador ainda exige permitir o microfone nessa
origem; em caso de recusa persistente no navegador integrado, compare a URL
completa no Chrome ou Edge. Falha de reprodução tem diagnóstico separado.

`--voice` mantém o primeiro modo por gravações. Os dois argumentos são
mutuamente exclusivos. O texto P2 e a demonstração P1 continuam disponíveis.

## Quem conversa e quem analisa

`gpt-realtime-2.1`, voz `marin`, conduz a conversa e gera áudio em streaming.
Ao pedir uma análise ao Codex, a função `consultar_codex` é executada no servidor
pela sessão app-server autenticada com a assinatura local. A resposta pública
concluída retorna ao modelo de voz. Conversa nativa, áudio e eventuais legendas
consomem a API OpenAI; a assinatura do Codex não cobre essa parte.

Este incremento usa o canário conversacional isolado da P2. A ponte solicita
análises e planejamento; não dá acesso a projetos, execução de comandos, escrita
de arquivos ou especialistas. A conexão futura com execução do squad exige sua
etapa própria de integração com os gates.

## Transporte e interrupção

O navegador transmite mídia por WebRTC. O servidor faz o bootstrap com destino
fixo `/v1/realtime/calls`; a chave permanente não vai ao navegador. Um WebSocket
de controle acompanha a chamada e é o único dono da execução das funções.
A interface recebe legendas públicas e estado projetado.

Semantic VAD detecta turnos e cancela a resposta nativa ao iniciar nova fala.
O navegador silencia a reprodução na detecção e o servidor invalida consultas
atrasadas; se houver análise Codex em execução, pede interrupção. Um retorno
antigo não dispara resposta espontânea. O playout usa um elemento de áudio
nativo, com um analisador Web Audio silencioso para medir a energia sem tocar
duas cópias do áudio.

A ponte mantém a propriedade da análise até seu término ou cancelamento
confirmado. Fala antes da confirmação de início e timeout da análise também
cancelam o turno. Se não houver confirmação em até 10 segundos, a sessão Codex
correspondente é desconectada; uma sessão substituta não é atingida. O estado
`cancelling` aparece como **Interrompendo análise Codex**. Não há reconexão
automática do harness pela ferramenta.

Falhas não causam reconexão, reenvio ou repetição automática de análise. A sessão
só fica pronta após abrir o canal RTC. Uma permissão concedida depois de cancelar
não abre uma chamada paga. IDs impedem cancelamento de uma sessão diferente.

## Limites deste ensaio

- Até 60 segundos, seis respostas e duas consultas Codex por sessão. Cada
  resposta tem até 512 tokens; esforço mínimo; contexto após instruções limitado
  a 4.000 tokens com truncamento.
- Consulta Codex até 4.000 caracteres; retorno público até 6.000.
- Reserva conservadora US$ 1 por sessão, antes de conectar, sem estorno
  automático. Orçamento local por processo de US$ 0,10 a US$ 2; um saldo menor
  que a reserva por sessão mantém apenas a configuração local disponível.
- Encerramento pelo servidor por tempo, perda de heartbeat ou mudança de sessão.
  O controle permanece conectado até a resposta de hangup. Recurso já ausente
  aparece como `already-ended`; falha de confirmação aparece como `unconfirmed`.
  Outra chamada paga fica bloqueada enquanto o encerramento anterior aguarda
  hangup e limpeza da análise. Encerramentos repetidos aguardam o mesmo
  resultado, correlacionado à chamada e à geração que o iniciou.
- Teto total aprovado: **US$ 6**. Reservas conhecidas dos ensaios: **US$ 5,30**.
  O comando acima usa o saldo conservador de **US$ 0,70**. Não é custo faturado.
  Reiniciar o processo não autoriza ampliar o teto.

Reservas e tokens observados não são o extrato da conta nem limite financeiro
global do fornecedor. Não se promete resposta em menos de um segundo: consultas
Codex têm latência própria. Emoção, portabilidade e uso prolongado não validados.

## Verificar

```powershell
node --test tests/presence*.test.mjs
npm run check
# Opt-in: voz Realtime paga + Codex; sem microfone físico:
node --env-file=.env tests/fixtures/presence-realtime-browser.mjs --live
```

A fixture envia fala demonstrativa por MediaStream, uma consulta sintética ao
Codex e nova fala para testar interrupção. `--live --short` limita a 15 segundos
e três respostas, com reserva US$ 0,30. Chamadas reais não fazem parte do CI.
[Evidências e pendências](changes/presence-realtime/verification.md).

Fontes oficiais consultadas em 2026-10-16: [WebRTC](https://developers.openai.com/api/docs/guides/voice-webrtc?voice-api=realtime),
[conversas](https://developers.openai.com/api/docs/guides/realtime-conversations),
[controle no servidor](https://developers.openai.com/api/docs/guides/voice-server-controls?voice-api=realtime),
[modelo](https://developers.openai.com/api/docs/models/gpt-realtime-2.1) e
[preços](https://developers.openai.com/api/docs/pricing).
