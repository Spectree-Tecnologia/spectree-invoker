# Retro — painel-sobrio (#115, v1.82.0)

Change: `painel-sobrio`

Escrita em 2026-10-28, depois do merge `c61a539`, a partir de `retro.mjs collect 115 --apply`
(`.spectree/retros/painel-sobrio.signals.json`), na mudança seguinte (44).

## O que foi lido

O registro da coleta:
- dois commits, o segundo corrigindo um Nit da revisão independente;
- CI verde no head;
- nenhum comentário;
- a seção Atrito presente;
- o release v1.82.0 nomeado pela proposta arquivada.

Nenhuma assinatura conhecida casou.

## Achados

- **R-011 · sem superfície real** · `information-access · mod · sem-superficie-real` · o v1.82.0
  entrou sem ser visto numa tela real. Décima segunda ocorrência. O Founder viu depois do merge e, no
  terminal, notou que o plano nunca aparecia ali, o que gerou a tarefa 44. Desde a tarefa 38 o plano só
  era desenhado no painel lateral, e nenhum teste montava a faixa acima do prompt.

## O que funcionou

A revisão independente reproduziu as falhas contra o código anterior antes do merge, e o único Nit que
pedia código foi pago no mesmo PR.
