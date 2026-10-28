# Retro — barra-plano-terminal (#116, v1.83.0)

Change: `barra-plano-terminal`

Escrita em 2026-10-28, depois do merge `5a7c9c3`, a partir de `retro.mjs collect 116 --apply`
(`.spectree/retros/barra-plano-terminal.signals.json`), na mudança seguinte (45).

## O que foi lido

O registro da coleta:
- dois commits, o segundo pagando a revisão independente;
- CI verde no head;
- nenhum comentário;
- a seção Atrito presente;
- o release v1.83.0 nomeado pela proposta arquivada.

Nenhuma assinatura conhecida casou.

## Achados

- **R-011 · sem superfície real** · `information-access · mod · sem-superficie-real` · o v1.83.0
  entrou sem ser visto numa tela real. Décima terceira ocorrência. A faixa do terminal só foi montada no
  kit.
- **R-018 · marca herdada no espalhamento** · `automated-checks · mod · marca-herdada-no-spread` · a
  revisão independente achou que `applyToPlan` copiava o `isSettled` do plano anterior com
  `{ ...plan }`. Com isso, uma lista nova saía da faixa no mesmo turno em que fechava. Os testes do autor
  só exercitavam a ferramenta de plano própria, não as de tarefa. Foi pago no mesmo PR com um teste que
  troca a lista depois do settle.

## O que funcionou

O código do Helper Desk foi lido direto na pasta do Founder, sem adivinhar pelo print, e a revisão em
contexto limpo pegou o bug antes do merge.
