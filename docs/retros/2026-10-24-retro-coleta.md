# Retro — retro-coleta (#80, v1.47.0)

Change: `retro-coleta`

Escrita em 2026-10-24, depois do merge `d8869ac`, a partir de `retro.mjs collect 80 --apply`,
registrada em `.spectree/retros/retro-coleta.signals.json`.

## O que foi lido

O registro da coleta (PR, 1 commit, 1 head de CI verde, nenhum comentário, seção Atrito presente,
release v1.47.0 nomeado pela proposta que o próprio merge arquivou) e a seção Atrito do PR, que
registra a troca de `gh pr view` pela API REST. Nenhuma assinatura conhecida casou.

## Achados

Nenhum novo. Os 98 minutos entre abrir e integrar foram espera pela autorização de merge, não
retrabalho: um commit e um head de CI.

**Observação para o D-012:** o gatilho dele, duas threads com PR aberto contra a `main` ao mesmo
tempo, aconteceu aqui. A tarefa 12 foi cortada sobre o head do #80 antes do merge, com a v1.48.0
reservada por coordenação, e reaplicada sobre `d8869ac` sem conflito. Não houve colisão, então
não há ocorrência nova do R-001, mas a reserva continua manual.

## O que funcionou

A própria coleta: esta retro saiu de um comando, sem leitura manual do PR.
