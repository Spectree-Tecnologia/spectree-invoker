# Verificação — Presence P3

Atualizado em 2026-10-16. Branch: `codex/presence-voz-invoker`. Base:
`87c6bc190a4558cc84c715f12f68839df3b7aecc`, main / v1.15.0, P2 integrada.
O Founder autorizou desenvolvimento e OpenAI até US$ 2 no ensaio, não merge.

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

## Pendências e limites

**Não há recomendação de merge ainda.** A chave OpenAI não estava disponível
no ambiente da sessão, inclusive na conferência de 2026-10-16. Nenhuma chamada
paga de áudio foi feita: gasto de áudio
provocado por esta execução = **US$ 0**. Nenhum microfone físico foi ligado.

Para concluir o aceite real: configurar a chave local, executar uma vez
`node scripts/presence-voice-canary.mjs --live` (duas chamadas, reserva US$ 0,20)
e validar com o usuário uma gravação em português, sua transcrição, a resposta
do Codex em voz, sua qualidade e a interrupção. Conferir consumo no provedor
sem ultrapassar os US$ 2 autorizados, contando todos os ensaios.

Não há benchmark comparativo com ElevenLabs, inferência de emoção, full duplex,
VAD ou streaming fim a fim. A fala começa após concluir o texto e receber a parte
de áudio; respostas longas podem ter pausas entre partes. Não foi validada uma
matriz de outros sistemas/navegadores/GPUs. Não alegar baixa latência real sem
medição do provedor. Projetos consumidores não foram usados como alvo de teste.

[Uso e configuração local](../../presence-voice.md).
