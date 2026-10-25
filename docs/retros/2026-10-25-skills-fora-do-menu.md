# Retro — skills-fora-do-menu (#95, v1.62.0)

Change: `skills-fora-do-menu`

Escrita em 2026-10-25, depois do merge `f26fe96`, a partir de `retro.mjs collect 95 --apply`
(`.spectree/retros/skills-fora-do-menu.signals.json`) e de `retro.mjs trends`, na mudança
seguinte (24).

## O que foi lido

O registro da coleta: 2 commits, 1 head de CI verde, 21 minutos aberto, 1 comentário, nenhum
comentário de revisão, seção Atrito presente e o release v1.62.0 nomeado pela proposta arquivada.
Nenhuma assinatura conhecida casou na coleta. `trends` antes desta retro: R-008, R-001 e R-004
recorrentes; nenhum quieto.

## Achados

- **R-001 · já contado** · `tool-economy · release · identificador-sequencial-disputado` · o Atrito
  registra o vermelho no `repo-changes` até o merge do #94 e o rebase com conflito em versão e
  ROADMAP. É a mesma ocorrência que a retro do #94 já contou do outro lado da dupla; a contagem não
  sobe. Dono: [D-012](../DEFERRED.md).
- **Sem assinatura** · a primeira rodada local teve 6 falhas da Presence por `node_modules` ausente
  no container, e `npm ci` resolveu. Esta mudança rodou `npm ci --ignore-scripts` antes da suíte e
  não viu a falha. Uma ocorrência, sem dono; vira assinatura se voltar.

## O que funcionou

O `check-plugin` passou a cobrar a chave que esconde as skills e a recusar a que impediria os agentes
de carregá-las, e a mudança entrou em 21 minutos com um head de CI.
