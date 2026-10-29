# Retro — avatar-espectral (#118, v1.85.0)

Change: `avatar-espectral`

Escrita em 2026-10-29, depois do merge `fa64575`, a partir de `retro.mjs collect 118 --apply`
(`.spectree/retros/avatar-espectral.signals.json`), na mudança seguinte (47).

## O que foi lido

O registro da coleta:
- três commits;
- CI verde nos dois heads;
- nenhum comentário;
- a seção Atrito diz que o efeito foi aprovado no primeiro preview;
- o release v1.85.0 nomeado pela proposta arquivada.

Nenhuma assinatura conhecida casou. O segundo head (`6f792e1`) foi uma correção da revisão
independente: o movimento reduzido não parava a ondulação, cujo relógio SMIL o CSS não alcança.

## Achados

- **R-011 · sem superfície real** · `information-access · mod · sem-superficie-real` · o v1.85.0
  entrou visto só em preview animado, não no app desktop. Décima quinta ocorrência.

## O que funcionou

A revisão independente pegou, antes do merge, a ondulação que escapava do movimento reduzido.
