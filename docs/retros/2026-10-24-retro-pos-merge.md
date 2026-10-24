# Retro — retro-pos-merge (#79, v1.46.0)

Change: `retro-pos-merge`

Escrita em 2026-10-24, depois do merge `845549c`. Primeira retro feita a partir de
`retro.mjs collect 79 --apply`, registrada em `.spectree/retros/retro-pos-merge.signals.json`.

## O que foi lido

O registro da coleta (PR, 1 commit, 1 run de CI verde por head, 6 minutos aberto, nenhum comentário,
seção Atrito presente, release v1.46.0 nomeado pela proposta que o próprio merge arquivou) e a seção
Atrito do PR. Nenhuma assinatura conhecida casou.

## Achados

- **R-005 · 3 · acesso a informação** · `information-access · retro · leitura-so-graphql` · no harness
  em nuvem, `gh pr view` é recusado (GraphQL indisponível) e o piloto teve de ler os PRs por outro
  caminho · a coleta lê o PR pela API REST (`gh api repos/<repo>/pulls/<n>`) · pago na tarefa 11b.
- **R-006 · 3 · economia de ferramenta** · `tool-economy · retro · contagem-manual` · o Atrito do #79
  registra que a contagem do R-002 no piloto saiu 9 e era 12, porque foi lida do ROADMAP e não dos
  diffs dos merges · a coleta lê o archive do próprio merge · pago na tarefa 11b.

## O que funcionou

O fechamento no próprio PR: a `main` em `845549c` já tinha a tarefa 11 arquivada e a linha 11 do
ROADMAP marcada, e a coleta confirma isso sem leitura manual (nenhum candidato
`fechamento-depois-do-merge`).
