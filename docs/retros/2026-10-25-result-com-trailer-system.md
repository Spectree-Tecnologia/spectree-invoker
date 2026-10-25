# Retro — result-com-trailer-system (#102, v1.69.0)

Change: `result-com-trailer-system`

Escrita em 2026-10-25, depois do merge, a partir de `retro.mjs collect 102 --apply`
(`.spectree/retros/result-com-trailer-system.signals.json`) e de `retro.mjs trends`, na mudança seguinte (31).

## O que foi lido

O registro da coleta: um commit, um head de CI, todos os runs completos e verdes, nenhum comentário,
PR aberto por 2 minutos, seção Atrito presente e o release v1.69.0 nomeado pela proposta arquivada.
Nenhuma assinatura conhecida casou na coleta. `trends` antes desta retro: R-011 recorrente.

## Achados

- **R-012 · 1 · acesso à informação** · `information-access · executor · fixture-sem-run-real` · o
  trailer `system` do Claude Code 2.1.302 foi reproduzido em fixture a partir do relato do projeto
  consumidor, não de um run real. A correção pode estar certa para a fixture e errada para a saída
  real. Fica aberto até o próximo `tasks.mjs run` do consumidor no v1.69.0 terminar sem `unknown`.

## O que funcionou

O bug chegou com a causa já isolada pelo consumidor, e a correção ficou numa regra estreita (só
`system` depois do único `result`), com os casos negativos testados.
