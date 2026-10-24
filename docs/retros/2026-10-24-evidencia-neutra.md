# Retro — evidencia-neutra (#86, v1.53.0)

Change: `evidencia-neutra`

Escrita em 2026-10-24, depois do merge `ea1699c`, a partir de `retro.mjs collect 86 --apply`
(`.spectree/retros/evidencia-neutra.signals.json`), na mudança seguinte (16).

## O que foi lido

O registro da coleta: 1 commit, 1 head de CI verde, 3 minutos aberto, nenhum comentário, seção
Atrito presente e o release v1.53.0 nomeado pela proposta que o próprio merge arquivou. Nenhuma
assinatura conhecida casou.

## Achados

- **R-008 · 2 · acesso à informação** · `information-access · ambiente · node-abaixo-do-piso` · o
  `npm run check` local teve um vermelho, `tests/ci-security.test.mjs`, porque esta sessão em
  nuvem ainda roda o Node 22.22.0, abaixo do piso. O mesmo teste falha na `main`, e a CI passou
  com o Node do `.nvmrc`. O script de ambiente que o Founder configurou só vale para sessões novas ·
  segunda ocorrência; segue aberto com o Founder, confirmar numa sessão nova.

## O que funcionou

A análise sugeria mover o log para `.spectree/`. A mudança chegou ao mesmo efeito tornando `.log/`
neutro por padrão, sem mexer no card do Platform Engineer nem no histórico dos consumidores. O PR
passou verde na primeira rodada.
