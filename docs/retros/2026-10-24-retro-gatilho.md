# Retro — retro-gatilho (#82, v1.49.0)

Change: `retro-gatilho`

Escrita em 2026-10-24, depois do merge `8376c80`, a partir de `retro.mjs collect 82 --apply`
(`.spectree/retros/retro-gatilho.signals.json`), na mudança seguinte (12b).

## O que foi lido

O registro da coleta: 2 commits (o segundo é o merge da `main` com o #81), 1 head de CI verde,
49 minutos aberto, nenhum comentário, seção Atrito presente e o release v1.49.0 nomeado pela
proposta que o próprio merge arquivou. Uma assinatura casou: identificador disputado, pelo commit
`c0a39c5 merge: integra main 1.48.0 (#81) e mantém a candidata em 1.49.0`.

## Achados

- **R-001 · 2 · economia de ferramenta** · `tool-economy · release · identificador-sequencial-disputado`
  · o candidato casou, e a retro confirma: com o #81 e o #82 abertos ao mesmo tempo, o #82 precisou
  integrar a `main` para resolver versão e linha do ROADMAP. O Atrito acrescenta uma terceira forma
  do mesmo achado: a branch do #82 ficou vermelha em `tests/repo-changes.test.mjs` até o #81 entrar,
  porque a retro que ela devia viajava no outro PR · ocorrência 15, segue no [D-012](../DEFERRED.md).
- **R-008** · o Atrito registra de novo o Node 22.22.0 da sessão em nuvem abaixo do piso · sem
  ocorrência nova a contar; segue aberto com o Founder.

## O que funcionou

A cobrança chegou antes desta mudança abrir: o aviso de que a próxima mudança deve a retro do
`retro-gatilho` veio pela coordenação e por `tests/repo-changes.test.mjs`, e esta retro é o
primeiro passo da 12b. Sem trabalho perdido.
