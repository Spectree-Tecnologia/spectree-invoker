# Presence P3 — voz do Invoker

Para a experiência de conversa contínua aprovada, use o
[modo Realtime](presence-realtime.md). Este documento descreve o primeiro modo
por gravações, mantido para diagnóstico e uso explícito.

O Codex produz o texto usando o login ChatGPT da P2; a API OpenAI de áudio
transcreve a gravação e sintetiza a resposta. Autenticação e cobrança são separadas.
O primeiro incremento oferece gravação explícita, texto revisável, reprodução
das novas respostas e interrupção. Ainda não há full duplex, captura contínua,
detecção automática de turno nem inferência de emoção.

## Iniciar no PowerShell

Na raiz do spectree-invoker, com dependências e login Codex preparados:

```powershell
# Digite a chave com entrada oculta; não a cole em chats ou arquivos versionados.
$presenceKey = Read-Host 'Chave da API OpenAI de áudio' -AsSecureString
$env:OPENAI_API_KEY = [System.Net.NetworkCredential]::new('', $presenceKey).Password
Remove-Variable presenceKey
try {
  npm run presence -- --codex --voice --budget-usd 2
} finally {
  Remove-Item Env:OPENAI_API_KEY -ErrorAction SilentlyContinue
}
```

Se a chave estiver no `.env` da raiz, ignorado pelo Git, carregue-o explicitamente:

```powershell
node --env-file=.env scripts/presence.mjs --codex --voice --budget-usd 0.7
```

O valor US$ 0,70 mantém a reserva restante dos ensaios conhecidos de 2026-10-16,
após a ampliação do teto total para US$ 5 e a
[verificação Realtime](changes/presence-realtime/verification.md).
O comando `npm run presence` não carrega
`.env` automaticamente. Não versione nem compartilhe esse arquivo.
Se aparecer `E_CODEX_UNAVAILABLE`, configure também `SPECTREE_CODEX_EXECUTABLE`
com o caminho completo do CLI instalado, conforme a [configuração Codex](presence-codex.md).

Abra a URL completa impressa, que contém uma credencial local efêmera. Conecte
o Codex e ative **Ouvir respostas**. Só respostas seguintes serão sintetizadas;
ativar a voz não reproduz nem cobra o histórico anterior.

**Gravar mensagem** solicita a permissão do microfone. **Concluir gravação**
envia até 45 segundos à OpenAI para transcrição. O texto volta ao compositor;
revise e pressione **Enviar mensagem**. A transcrição não envia uma ordem ao
Codex automaticamente e não sobrescreve um rascunho existente.

Antes de gravar, clique em **Escolher microfone**, permita o acesso no navegador
e selecione a entrada desejada na lista **Microfone** da Presence. A permissão
libera o acesso ao site; a escolha do dispositivo é feita nessa lista. Configurar
a entrada não cria gravação nem chama a API de áudio. Se a permissão já existir,
as entradas são listadas sem abrir o dispositivo padrão. Mesmo que o driver do
microfone padrão falhe ao abrir, a lista é atualizada para permitir escolher
outra entrada. A seleção fica somente
no navegador. Durante a gravação, um medidor mostra o sinal em dBFS e a energia
do personagem acompanha a entrada. Uma captura praticamente silenciosa é recusada localmente, sem envio
à API (`E_MIC_SILENT`). Se a API não retornar fala reconhecida ou texto válido,
a interface explica o problema (`E_TRANSCRIPT`); confira o dispositivo de entrada
selecionado no navegador. **Confira sua gravação** reproduz o último WAV
localmente, sem outra chamada paga. Esse áudio fica em memória; a referência
local é descartada ao iniciar outra gravação, trocar o microfone ou a sessão,
enviar texto, ocultar ou fechar a página. Falhas de transporte, formato e reprodução também
mostram códigos seguros, preservando a conversa por texto e sem retry automático.

**Parar áudio** encerra captura, processamento de áudio ou reprodução.
**Interromper** continua cancelando o turno Codex, com confirmação da P2.
Gravar enquanto o Invoker fala para a reprodução antes de abrir o microfone.
Ocultar/fechar a página interrompe áudio; uma nova sessão desativa a voz.

Sem chave, os controles de voz ficam desabilitados com uma explicação e a
conversa textual continua disponível. `npm run presence -- --codex` preserva
a P2 com microfone bloqueado; `npm run presence` mantém a demonstração P1.

## Dados e limites

O adaptador usa `gpt-4o-mini-transcribe` e `gpt-4o-mini-tts`, voz `marin`.
A chave fica no servidor de áudio e é removida do ambiente do subprocesso
Codex. Nunca vai ao navegador. Gravações e respostas de áudio ficam em memória.
Transcrever envia áudio à OpenAI; ouvir respostas envia texto público à síntese.
Isso não promete ausência de registros do provedor. Raciocínio interno e
ferramentas não entram no fluxo; fala não aprova gates nem executa trabalho.

- WAV mono 16 kHz, de 0,5 a 45 segundos; formato e duração validados no servidor.
- Síntese apenas da última resposta pública concluída, em partes de até 1.200
  caracteres, sem aceitar texto arbitrário do navegador.
- PCM de saída a 24 kHz, até 120 s por parte; 30 s por operação de API.
- Uma operação de áudio por vez, sem retry automático. Cancelamento, nova sessão,
  novo turno ou perda de contato invalidam o resultado. Duplicatas não cobram de novo.
- A energia visual vem do analisador Web Audio da saída, não do tamanho do texto.

## Orçamento e ensaios

O teto inicial era US$ 2; o Founder ampliou o total dos ensaios para US$ 5 ao
validar a Realtime. Neste modo por gravações, o controle reserva **US$ 0,10 por
chamada**, antes de enviá-la, com orçamento de US$ 0,10 a US$ 2 por processo.
US$ 2 permitem no máximo 20 chamadas de transcrição/síntese somadas. Erros e
cancelamentos não estornam a reserva, pois o provedor pode ter processado o pedido.
Reserva não é extrato nem limite financeiro global da conta. Reiniciar o servidor
reinicia o contador; não use isso para ultrapassar o orçamento autorizado.

```powershell
node --test tests/presence*.test.mjs
npm run check
# Opt-in, chave e orçamento necessários; duas chamadas, frase sintética fixa:
node scripts/presence-voice-canary.mjs --live
```

O canário de API reserva US$ 0,20 e não liga microfone. Os testes normais não
fazem chamadas pagas. A fixture `tests/fixtures/presence-voice-browser.mjs` usa
texto roteirizado e tom modulado: prova reprodução/animação/cancelamento, não
qualidade de fala ou desempenho da OpenAI.

Para testar o capturador real do navegador com a fala demonstrativa do projeto,
sem microfone físico: `node tests/fixtures/presence-capture-browser.mjs`. A
transcrição é simulada nesse modo. O opt-in
`node --env-file=.env tests/fixtures/presence-capture-browser.mjs --live`
permite uma transcrição OpenAI, com reserva US$ 0,10. Abra a URL impressa e
clique em **Capturar fala demonstrativa**. Não faz parte do CI.

A interface mede transcrição, envio até conclusão do Codex e resposta concluída
até início de reprodução. A síntese começa após a conclusão do texto, recebendo
cada parte inteira antes de tocar. Ainda não é streaming fim a fim; partes longas
podem ter pausas. Não se promete latência abaixo de um segundo.
Qualidade em português e latência real devem ser registradas na
[verificação P3](changes/presence-voz-invoker/verification.md).

Fontes oficiais consultadas em 2026-10-15: [síntese](https://developers.openai.com/api/docs/guides/text-to-speech),
[transcrição](https://developers.openai.com/api/reference/resources/audio/subresources/transcriptions/methods/create)
e [preços](https://developers.openai.com/api/docs/pricing). OpenAI foi escolhida
pelo Founder; não foi feito benchmark comparativo com ElevenLabs.
