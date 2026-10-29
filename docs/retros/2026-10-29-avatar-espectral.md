# Retro — avatar-espectral (#118, v1.85.0)

Change: `avatar-espectral`

Escrita em 2026-10-29, depois do merge `fa64575`, na mudança seguinte (47). Os sinais foram lidos pela
API do GitHub, não por `retro.mjs collect`: o `gh` desta sessão não tinha login, então não há
`.spectree/retros/avatar-espectral.signals.json`.

## O que foi lido

O PR #118 e o head `6f792e1`:
- três commits, o último pagando o achado Importante da revisão independente;
- CI verde no head (`classify`, `plugin`, `required`; `tag` pulado);
- nenhum comentário;
- a seção Atrito presente, dizendo "Nenhum";
- o release v1.85.0 nomeado pela proposta arquivada;
- aberto às 11:56Z e mergeado às 12:01Z.

## Achados

- **R-011 · sem superfície real** · `information-access · mod · sem-superficie-real` · o v1.85.0
  entrou visto só em preview animado no navegador, não no app desktop. Décima quinta ocorrência.
- **R-019 · coleta sem gh** · `information-access · retro · coleta-sem-gh` · esta retro não rodou
  `retro.mjs collect`, porque a sessão não tinha `gh` autenticado. Os mesmos sinais saíram da API, mas
  sem o registro em `.spectree/retros/` e sem a comparação com as assinaturas conhecidas.

A revisão independente achou um problema Importante (a ondulação por SMIL escapava da regra de
movimento reduzido), pago no próprio PR. Três Nits ficaram registrados no PR, sem push.

## O que funcionou

O revisor em contexto limpo pegou, antes do merge, um caso que o teste do kit não cobria: CSS não para
uma animação SMIL.
