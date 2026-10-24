# Retro — emenda-caminhos (#90, v1.57.0)

Change: `emenda-caminhos`

Escrita em 2026-10-24, depois do merge `084b01d`, a partir de `retro.mjs collect 90 --apply`
(`.spectree/retros/emenda-caminhos.signals.json`), na mudança seguinte (20).

## O que foi lido

O registro da coleta: 1 commit, 1 head de CI verde, nenhum comentário, seção Atrito presente e o
release v1.57.0 nomeado pela proposta que o próprio merge arquivou. Nenhuma assinatura conhecida
casou.

## Achados

- **R-008 · 6 · acesso à informação** · `information-access · ambiente · node-abaixo-do-piso` · o
  mesmo vermelho local do piso do Node nesta sessão · sexta ocorrência, aberto com o Founder até
  ser confirmado numa sessão nova.

## O que funcionou

A regra que pede uma pessoa ficou numa função pura (`planPathAmendment`), testada sem disco, e o
comando só escreve o que ela decidiu. A recusa e o no-op foram conferidos sem gravar nada.
