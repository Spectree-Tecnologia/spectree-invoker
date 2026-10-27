# Retro — painel-sessao-longa (#111, v1.78.0)

Change: `painel-sessao-longa`

Escrita em 2026-10-27, depois do merge `94fb500`, a partir de `retro.mjs collect 111 --apply`
(`.spectree/retros/painel-sessao-longa.signals.json`), na mudança seguinte (40).

## O que foi lido

O registro da coleta: dois commits, CI verde nos dois heads, nenhum comentário, a seção Atrito presente
e o release v1.78.0 nomeado pela proposta arquivada. Nenhuma assinatura conhecida casou.

## Achados

- **R-011 · sem superfície real** · `information-access · mod · sem-superficie-real` · o v1.78.0
  entrou sem ser visto no app desktop, e a causa da quebra seguiu inferida, sem o log do app. Nona ocorrência.
- **R-017 · sessão longa sem teste** · `automated-checks · mod · sessao-longa-sem-teste` · o teste do
  #111 mediu o desenho e não a escrita: o levantamento de performance pedido pelo Founder logo depois achou
  cada passo regravando o estado de todos os subagentes. Segunda ocorrência; a tarefa 40 paga com um teste de
  orçamento que mede as escritas.

## O que funcionou

O revisor em contexto limpo achou o card que sumia ao terminar, e a correção entrou antes do merge.
