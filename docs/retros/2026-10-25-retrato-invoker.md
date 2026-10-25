# Retro — retrato-invoker (#97, v1.64.0)

Change: `retrato-invoker`

Escrita em 2026-10-25, depois do merge `4acf4a1`, a partir de `retro.mjs collect 97 --apply`
(`.spectree/retros/retrato-invoker.signals.json`) e de `retro.mjs trends`, na mudança seguinte (26).

## O que foi lido

O registro da coleta: 6 commits, todos os heads de CI verdes, nenhum comentário, seção Atrito
presente e o release v1.64.0 nomeado pela proposta arquivada. Nenhuma assinatura conhecida casou na
coleta. `trends` antes desta retro: R-001 e R-004 recorrentes; R-008 quieto.

## Achados

- **R-011 · 2 · acesso à informação** · `information-access · mod · sem-superficie-real` · de novo:
  o retrato e os orbs foram vistos no Chromium e no kit, e o app desktop, que tira o `<image>` de um
  `Svg`, mostrou só os brilhos. A prévia passou a parecer prova sem ser a superfície. Pago em parte
  pela tarefa 26, que troca o bitmap por vetor e cobra a ausência de `<image>` no CI; o resto, ver o
  app antes do pedido de merge de um mod, segue aberto.
- **O `ui.find` do kit ignora `alt`.** O primeiro teste do card achou o SVG errado e passou no
  código antigo; visto porque o teste foi rodado contra o código anterior. Sem assinatura nova: é o
  hábito de ver o teste falhar funcionando.

## O que funcionou

A revisão em contexto limpo pegou duas brechas reais na guarda do retrato (o teto fora do CI e a
âncora multilinha), e o Founder trocou a arte de terceiros por imagens próprias no mesmo PR.
