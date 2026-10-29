# Retro — regra-multi-caminho (#123, v1.89.0)

Change: `regra-multi-caminho`

Escrita em 2026-10-29, depois do merge `ee1fd1d`, a partir de `retro.mjs collect 123 --apply`
(`.spectree/retros/regra-multi-caminho.signals.json`), na mudança seguinte (51).

## O que foi lido

O registro da coleta:
- um commit;
- CI verde no único head;
- nenhum comentário;
- a seção Atrito presente.

Nenhuma assinatura conhecida casou.

## Achados

- **R-004 · teto sem folga** · `automated-checks · protocol · teto-sem-folga` · para caber no teto,
  três trechos do card do Architect foram encurtados. No Codex, o card ficou a 51 bytes do teto.
  Sétima ocorrência, [D-013](../DEFERRED.md). A mudança própria continua devida.
- **R-001 · identificador disputado** · `tool-economy · release · identificador-sequencial-disputado`
  · o #123 e o #122 miraram a v1.89.0 ao mesmo tempo. O #122, que mergeou depois, passou para a
  v1.90.0 e trocou a retro devida. Décima nona ocorrência, [D-012](../DEFERRED.md).

## O que funcionou

As duas threads combinaram a ordem antes do merge. O #123 entrou num commit só, com a CI verde de
primeira.
