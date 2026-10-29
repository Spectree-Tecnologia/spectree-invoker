# Retro — rebrand-mascote (#117, v1.84.0)

Change: `rebrand-mascote`

Escrita em 2026-10-29, depois do merge `3313a67`, a partir de `retro.mjs collect 117 --apply`
(`.spectree/retros/rebrand-mascote.signals.json`), na mudança seguinte (46).

## O que foi lido

O registro da coleta:
- quatro commits, três deles ajustes pedidos pelo Founder sobre o preview;
- CI verde no único head;
- nenhum comentário;
- a seção Atrito presente;
- o release v1.84.0 nomeado pela proposta arquivada.

Nenhuma assinatura conhecida casou.

## Achados

- **R-011 · sem superfície real** · `information-access · mod · sem-superficie-real` · o v1.84.0
  entrou visto só em preview renderizado no navegador, não no app desktop. Décima quarta ocorrência. O
  preview pegou três ajustes antes do PR, mas não substitui a tela real.

A revisão independente não achou nada Importante. Deixou quatro Nits registrados no PR, sem push: o
rosto bravo do QE em execução igual ao de falha, os ids fixos de SVG, o centro sorrindo sem teste e uma
data na proposta.

## O que funcionou

Mostrar um preview a cada pedido deixou o Founder corrigir o rumo três vezes antes do PR, sem custo
de CI.
