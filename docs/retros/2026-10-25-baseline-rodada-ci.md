# Retro — baseline-rodada-ci (#91, v1.58.0)

Change: `baseline-rodada-ci`

Escrita em 2026-10-25, depois do merge `4a51738`, a partir de `retro.mjs collect 91 --apply`
(`.spectree/retros/baseline-rodada-ci.signals.json`), na mudança seguinte (21).

## O que foi lido

O registro da coleta: 1 commit, 1 head de CI verde, nenhum comentário e nenhum comentário de
revisão, PR aberto às 18:45:38Z e integrado às 18:47:00Z, seção Atrito presente ("o único vermelho
local é o do piso do Node desta sessão") e o release v1.58.0 nomeado pela proposta que o próprio
merge arquivou. Nenhuma assinatura conhecida casou.

## Achados

- **R-010 · 1 · padrões de revisão** · `review-standards · pr · sem-revisao-independente` · o PR
  foi integrado um minuto depois de aberto, sem revisão de ninguém além da thread que o escreveu; o
  mesmo vale para os 50 PRs do #42 ao #91, e o escape do #76 (R-009) mostra o custo · revisor em
  contexto limpo por head, guiado pelo `REVIEW.md` · pago nesta mudança (tarefa 21).
- **R-008 · 6 · acesso à informação** · `information-access · ambiente · node-abaixo-do-piso` · a
  sessão desta mudança roda Node v22.23.4 e a suíte da `main` em `4a51738` ficou verde (629 de 632,
  3 pulados, 0 falhas) · primeira sessão no piso; não reproduzido · pago pelo ambiente.

## O que funcionou

A identidade da rodada é conferida antes de gravar qualquer coisa: workflow, evento, head e jobs
declarados. Uma rodada que não fala pela base não vira evidência.
