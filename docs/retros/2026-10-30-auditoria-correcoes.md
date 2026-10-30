# Retro — auditoria-correcoes (#124, v1.91.0)

Change: `auditoria-correcoes`

Escrita em 2026-10-30, depois do merge `09fae4d`, a partir de `retro.mjs collect 124 --apply`
(`.spectree/retros/auditoria-correcoes.signals.json`), na mudança seguinte (53).

## O que foi lido

O registro da coleta:
- quatro commits, CI verde em todos os heads;
- nenhum comentário no PR;
- a seção Atrito presente.

Nenhuma assinatura casou.

## Achados

- **R-022 · push recusado pelo classificador** · `tool-economy · push · classificador-recusa-push` ·
  o push com `--force-with-lease` foi recusado e o push simples bastou, porque era fast-forward. No
  #122, o primeiro push também foi recusado e passou com o commit e o push separados. São duas
  ocorrências. A causa está no ambiente da sessão, não neste repositório: fica registrado.
- **Sem achado novo** sobre a entrega. Os devidos que o próprio PR declarou continuam no
  [D-027 e no D-028](../DEFERRED.md): escrever sem seguir link e a importação com
  `source_kind: observed_execution`. O D-029 segue sem observação no Windows.

## O que funcionou

Os quatro casos falharam antes da correção e passaram depois. As três rodadas de revisão
apertaram a resolução do `git` antes do merge.
