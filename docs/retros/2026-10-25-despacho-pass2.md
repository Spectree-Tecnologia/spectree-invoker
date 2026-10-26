# Retro — despacho-pass2 (#108, v1.75.0)

Change: `despacho-pass2`

Escrita em 2026-10-26, depois do merge `aa1e5ca`, a partir de `retro.mjs collect 108 --apply`
(`.spectree/retros/despacho-pass2.signals.json`), na mudança seguinte (37).

## O que foi lido

O registro da coleta: quatro commits, um head de CI, todos os runs completos e verdes, nenhum
comentário, PR aberto por 2 minutos, seção Atrito presente e o release v1.75.0 nomeado pela proposta
arquivada. Nenhuma assinatura conhecida casou; a seção Atrito trouxe duas.

## Achados

- **R-015 · 3 · padrões de revisão** · `review-standards · proposta · identidade-depois-do-codigo` · a
  terceira rodada de revisão achou o formato de `pass2.mjs scope` recusado pelo brief e uma rodada só
  de mutantes sem forma de abrir: a proposta não dizia de onde vinha o escopo de uma rodada posterior,
  e a seção Identidade foi refeita depois do código. Terceira recorrência; segue pedindo mudança
  própria pelo `retro-melhorias`.
- **R-004 · 6 · checagens automáticas** · `automated-checks · protocol · teto-sem-folga` · a regra do
  brief ficou fora do núcleo porque sobravam 58 bytes. Na mudança seguinte (37) o card do Architect
  ficou a 15 bytes do teto, no Codex. Segue aberto no [D-013](../DEFERRED.md).

## O que funcionou

O brief é um arquivo pinado por bytes: o teste de escopo movido não compara campo nenhum, e por isso
pegou também um brief apagado.
