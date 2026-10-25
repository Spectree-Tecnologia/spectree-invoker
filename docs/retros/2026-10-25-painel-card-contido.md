# Retro — painel-card-contido (#100, v1.67.0)

Change: `painel-card-contido`

Escrita em 2026-10-25, depois do merge `ea10ace`, a partir de `retro.mjs collect 100 --apply`
(`.spectree/retros/painel-card-contido.signals.json`) e de `retro.mjs trends`, na mudança seguinte (29).

## O que foi lido

O registro da coleta: commits com todos os heads de CI verdes, nenhum comentário, seção Atrito presente e
o release v1.67.0 nomeado pela proposta arquivada. Nenhuma assinatura conhecida casou na coleta.

## Achados

- **R-011 · 5 · acesso à informação** · `information-access · mod · sem-superficie-real` · de novo o
  merge veio antes do app. Desta vez o Founder viu no app desktop a linha `tipo · modelo · esforço`
  funcionando depois do merge, e no momento do merge um painel aberto mostrou "spectree has not
  drawn in this pane" até a atualização do plugin; a causa não foi confirmada. Fica aberto.

## O que funcionou

Juntar no mesmo PR o pedido que chegou durante o trabalho (tipo, modelo e esforço) poupou um ciclo de
merge e de versão.
