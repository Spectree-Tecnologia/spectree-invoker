# Retro — painel-plano-proprio (#110, v1.77.0)

Change: `painel-plano-proprio`

Escrita em 2026-10-26, depois do merge `1686d2e`, a partir de `retro.mjs collect 110 --apply`
(`.spectree/retros/painel-plano-proprio.signals.json`), na mudança seguinte (39).

## O que foi lido

O registro da coleta: dois commits, CI verde em todos os heads, nenhum comentário, a seção Atrito presente
e o release v1.77.0 nomeado pela proposta arquivada. Nenhuma assinatura conhecida casou.

## Achados

- **R-011 · sem superfície real** · `information-access · mod · sem-superficie-real` · o v1.77.0
  entrou sem ser visto no app desktop; a própria Atrito do PR disse isso. Oitava ocorrência.
- **R-017 · sessão longa sem teste** · `automated-checks · mod · sessao-longa-sem-teste` · duas horas
  depois do merge, o Founder viu o painel parar de desenhar numa sessão com mais de 20 subagentes. Cada
  card concluído levava a pintura grande do orbe, uns 50 mil caracteres, e o painel redesenha tudo a cada
  segundo. O defeito veio do #97, e nenhum teste montava o painel com uma sessão longa. A tarefa 39 paga.

## O que funcionou

A causa raiz do plano veio de ler o código da referência, não de adivinhar, e o Founder decidiu em um cartão.
