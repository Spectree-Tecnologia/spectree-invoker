# Retro — mutacoes-em-lote (#88, v1.55.0)

Change: `mutacoes-em-lote`

Escrita em 2026-10-24, depois do merge `ec0a0ff`, a partir de `retro.mjs collect 88 --apply`
(`.spectree/retros/mutacoes-em-lote.signals.json`), na mudança seguinte (18).

## O que foi lido

O registro da coleta: 1 commit, 1 head de CI verde, nenhum comentário, seção Atrito presente e o
release v1.55.0 nomeado pela proposta que o próprio merge arquivou. Nenhuma assinatura conhecida
casou.

## Achados

- **R-008 · 4 · acesso à informação** · `information-access · ambiente · node-abaixo-do-piso` · o
  mesmo vermelho local do piso do Node nesta sessão · quarta ocorrência, aberto com o Founder até
  ser confirmado numa sessão nova.

## O que funcionou

O teste do lote nasceu discriminante: o segundo mutante lê o fragmento que o primeiro substituiu,
então tirar a reversão entre mutantes derruba o teste. Isso foi conferido antes do PR.
