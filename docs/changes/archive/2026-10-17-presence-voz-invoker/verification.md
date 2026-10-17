# Verificação — Presence P3

Atualizado em 2026-10-16. Branch: `codex/presence-voz-invoker`. Base:
`87c6bc190a4558cc84c715f12f68839df3b7aecc`, main / v1.15.0, P2 integrada.
O Founder autorizou desenvolvimento e OpenAI até US$ 2 no ensaio, não merge.

Retorno mais recente do Founder: os testes funcionaram após a configuração do
microfone, mas a interação desejada é Realtime. Isso valida a base manual; não
representa aceite da experiência final. A continuidade é definida na
[proposta Realtime](../2026-10-17-presence-realtime/proposal.md), antes dos especialistas.

## Implementado

Captura explícita via AudioWorklet, WAV limitado, transcrição revisável, adaptador
OpenAI no servidor, síntese da última resposta pública concluída, reprodução PCM
com analisador Web Audio e cancelamento por identidade da operação. P1 e P2
permanecem disponíveis sem configurar a API de áudio. Nenhuma dependência nova.

A chave de áudio é retirada do ambiente do subprocesso Codex. Toda chamada paga
é opt-in e consome reserva local antes do envio. A reserva não é custo faturado.
Falhas, cancelamentos e IDs repetidos não liberam chamadas extras nem provocam
retry automático. Mudanças de sessão/turno invalidam resultados atrasados.

## Testes automatizados

- Primeira regressão `npm run check`: **439/439 passaram**, sem falhas, skips ou
  cancelamentos, em 329.705 ms. Inclui drift e integridade do pacote.
- Depois dessa execução foram ajustados o isolamento da chave no subprocesso e
  o instante usado na métrica de início de reprodução.
- Suíte focada final de sessão + voz: **24/24 passaram**, incluindo 12 casos de
  voz e um caso adicional que prova a remoção da chave do ambiente do Codex.
- Regressão completa final `npm run check`: **440/440 passaram**, sem falhas,
  cancelamentos ou skips, em 486.001 ms. Resultado recuperado do log na retomada
  de 2026-10-16; inclui drift, integridade e a suíte após os ajustes finais.

Os testes cobrem WAV corrompido/limitado, quotas, identidades, síntese de texto
arbitrário recusada, cancelamento tardio que não afeta operação nova, erros de
provedor sem vazamento, HTTP autenticado, rascunho preservado, perda de resposta
sem retry, ausência de permissão e microfone obtido após cancelamento.

O aviso Git `fatal: bad object 000...` é produzido deliberadamente pelo teste
de comparação indisponível; não representa falha da suíte.

## Navegador

Fixture explícita `tests/fixtures/presence-voice-browser.mjs`: sem Codex, API ou
microfone, usando tom modulado e texto roteirizado. O modelo mostrado na tela
identifica o canário sintético. Ativar voz não reproduziu o histórico; após enviar
uma mensagem, a nova resposta gerou áudio e estado **Falando · Invoker**.

O canvas registrou energia **0,7332**, com `speaker=invoker`. Ao clicar em
**Parar áudio**, a energia passou a **0,0000**, `speaker=none` e o botão ficou
desabilitado. Nenhum erro/warning foi observado nessa inspeção. Isso prova o
caminho PCM → Web Audio → renderer e o cancelamento, não qualidade de voz real.
Captura: `presence-p3-synthetic.jpg` nos artefatos locais desta conversa.

A prévia real da P3 recusou habilitar áudio sem `OPENAI_API_KEY` e manteve
conexão textual com o Codex, modelo resolvido `gpt-6.1-sol`.
Na versão final, uma pergunta sintética chegou a **Resposta concluída**; nenhum
erro/warning foi observado. Em viewport móvel de 390 × 844, largura útil e
scroll foram ambos 375 px, sem overflow horizontal. Capturas finais:
`presence-p3-desktop.jpg` e `presence-p3-mobile.jpg` nos artefatos da conversa.

## Canário real de API — 2026-10-16

A chave fornecida localmente no `.env` foi validada sem exibir seu conteúdo.
O arquivo não estava versionado e agora consta no `.gitignore`.
`node --env-file=.env scripts/presence-voice-canary.mjs --live` passou em uma
execução: uma síntese e uma transcrição com frase sintética fixa, sem microfone.

- Síntese: **2.565 ms**; áudio resultante: **7,8 s**.
- Transcrição: **2.390 ms**; termos esperados reconhecidos.
- Reserva local: **US$ 0,20**, deixando US$ 1,80 de reserva para o ensaio.
  Isso não representa custo faturado; o extrato do provedor não foi consultado.

## Pendências e limites

### Retorno sobre gravação de voz — 2026-10-16

O Founder confirmou ouvir a resposta gerada a partir de texto digitado e relatou
falha ao tentar gravar a própria voz. A captura de tela mostrava mensagem genérica
e reserva local de US$ 0,30; não expunha o código da falha. Portanto, a causa
específica da gravação ainda não foi estabelecida.

Foram corrigidas a apresentação de erros de transcrição vazia/inválida, formato,
limites e transporte, incluindo um código seguro na interface. Captura silenciosa
agora é recusada antes do envio à API, e o sinal recebido do microfone alimenta
a energia visual durante a gravação. Não há retry automático nem exposição de
respostas brutas do provedor.

**28/28 testes focados de sessão e voz passaram** após o ajuste. Novos casos
cobrem captura silenciosa sem envio, captura a 44,1/48 kHz, WAV de dispositivo
simulado até transcrição via HTTP autenticado e retorno ao rascunho, ausência de
envio ao Codex, transcrição vazia e perda de transporte sem retry. Nenhuma chamada
paga adicional foi feita nesta investigação; a validação do microfone físico do
Founder continua pendente, agora com indicação específica se falhar novamente.
Regressão completa da Presence após esses ajustes: **48/48 testes passaram**;
`check:drift` e `check:plugin` também passaram.

### Diagnóstico da entrada física — continuação em 2026-10-16

O novo retorno mostrou `E_TRANSCRIPT`; o Founder também informou que o personagem
quase não reagia durante sua fala. Não se concluiu falha de hardware: o adaptador
agora diferencia texto vazio (`E_TRANSCRIPT`), resposta incompatível
(`E_TRANSCRIPT_RESPONSE`) e texto acima do limite (`E_TRANSCRIPT_LIMIT`).

A interface ganhou seleção de entrada após permissão, medidor de sinal em dBFS
e reprodução local do último WAV. IDs e nomes de dispositivos não entram nas
chamadas de áudio. A prévia é somente em memória e sua referência é descartada
ao trocar sessão/dispositivo, iniciar gravação, enviar texto, ocultar/fechar a
página. O CSP permite mídia `blob:` somente no modo de voz.

A fixture `presence-capture-browser.mjs --live` passou áudio demonstrativo pelo
AudioContext e AudioWorklet reais do navegador, MediaStream, WAV e OpenAI, sem
microfone físico ou Codex. Áudio capturado: **12,682625 s**; transcrição:
**2.543 ms**, com a frase esperada reconhecida. O nome inglês Architect foi
transcrito foneticamente como Architekt, levando a ajustar o critério da fixture
para palavras inequívocas da frase; não foi feita outra chamada por isso.
Reserva adicional: **US$ 0,10**, não custo faturado. Considerando o canário
inicial (US$ 0,20) e os painéis apresentados pelo Founder (US$ 0,30 e US$ 0,10
em processos diferentes), o saldo conservador de reserva do ensaio é **US$ 1,30**.
O extrato do provedor não foi consultado.

**50/50 testes da Presence passaram** com os novos controles e distinção de
erros. Conferência do sinal e aceite com o microfone físico continuam pendentes.

### Escolha antes da gravação — continuação em 2026-10-16

O Founder identificou o microfone USB do headphone como defeituoso e o integrado
do notebook como funcional. O fluxo anterior listava dispositivos apenas após
abrir uma captura, criando uma dependência da entrada padrão. A permissão do
navegador também não oferecia a seleção esperada pelo usuário.

Adicionado **Escolher microfone**: consulta as entradas sem gravar, solicita
permissão somente quando necessário e encerra imediatamente o stream usado para
obter essa permissão. Mesmo após falha ao abrir o USB padrão, enumera as entradas
disponíveis para permitir escolher o notebook. Com permissão existente, não
precisa abrir o dispositivo padrão. A seleção explícita é preservada nas
atualizações da lista e aplicada como `deviceId.exact` na captura seguinte.

**53/53 testes da Presence passaram**, incluindo default USB com NotReadableError,
seleção explícita do notebook, probe de permissão sem gravação/API, encerramento
de stream tardio e preservação da seleção. Nenhuma chamada paga nesta correção.
Permissão do site e teste final no hardware do Founder ainda dependem da interação
dele no navegador.

### Inicialização fora do aplicativo Codex — 2026-10-16

O terminal do usuário apresentou `E_CODEX_UNAVAILABLE`: o executável disponível
no ambiente do aplicativo não estava no PATH persistente do Windows. A Presence
agora aceita `SPECTREE_CODEX_EXECUTABLE` no ambiente do servidor, carregável pelo
`.env`, sem comandos recebidos do navegador nem alteração do PATH global.
A instalação local foi configurada no arquivo ignorado; a chave foi preservada.

Regressão focada após a correção: **25/25 testes de sessão e voz passaram**,
incluindo caminho com espaços, prioridade do argumento explícito e isolamento
da chave de áudio. Conexão real com PATH vazio chegou a `ready`, modelo
`gpt-6.1-sol`, em canário isolado, sem mensagens ou chamadas de áudio.
A suíte completa de 440 testes acima antecede esta correção.

**Não há recomendação de merge ainda.** O canário valida acesso e integração
com as APIs, não qualidade percebida nem conversa completa pelo navegador.
Nenhum microfone físico foi ligado.

Para concluir o aceite real, validar com o usuário uma gravação em português,
sua transcrição, a resposta
do Codex em voz, sua qualidade e a interrupção. Conferir consumo no provedor
sem ultrapassar os US$ 2 autorizados, contando todos os ensaios.

Não há benchmark comparativo com ElevenLabs, inferência de emoção, full duplex,
VAD ou streaming fim a fim. A fala começa após concluir o texto e receber a parte
de áudio; respostas longas podem ter pausas entre partes. Não foi validada uma
matriz de outros sistemas/navegadores/GPUs. Não alegar baixa latência real sem
medição do provedor. Projetos consumidores não foram usados como alvo de teste.

[Uso e configuração local](../../../presence-voice.md).
