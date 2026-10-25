# Retro — executor-pos-fechamento (#104, v1.71.0)

Change: `executor-pos-fechamento`

Escrita em 2026-10-25, depois do merge `fd882ed`, a partir de `retro.mjs collect 104 --apply`
(`.spectree/retros/executor-pos-fechamento.signals.json`) e de `retro.mjs trends`, na mudança seguinte (33).

## O que foi lido

O registro da coleta: dois commits, um head de CI, todos os runs completos e verdes, nenhum comentário,
PR aberto por 2 minutos, seção Atrito presente e o release v1.71.0 nomeado pela proposta arquivada.
Nenhuma assinatura conhecida casou na coleta. A seção Revisão independente do PR: duas rodadas, um
achado Importante na primeira, corrigido antes do push.

## Achados

- **R-013 · 1 · acesso à informação** · `information-access · ambiente · dependencias-nao-instaladas` ·
  o primeiro `npm run check` da sessão deu vermelho em seis arquivos do Presence porque `npm ci` não
  tinha rodado. Primo do R-008 (o ambiente da sessão não é o do CI), com outra causa. Fica aberto.
- **R-014 · 1 · checagens automáticas** · `automated-checks · executor · janela-sem-teste-discriminante` ·
  a lista de ações que abre a janela de `repair` e `verify` em `implemented` não tem teste que a
  discrimine: a fixture do executor é `legacy`, e uma mutação que tira a lista passa verde (visto pelo
  revisor da segunda rodada). Fica aberto.

## O que funcionou

A revisão independente pegou na primeira rodada uma janela larga demais, que nenhum teste pegaria, e
o teste discriminante mostrou as duas camadas do bug separadamente.
