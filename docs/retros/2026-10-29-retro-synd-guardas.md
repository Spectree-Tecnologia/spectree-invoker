# Retro — retro-synd-guardas (#121, v1.88.0)

Change: `retro-synd-guardas`

Escrita em 2026-10-29, depois do merge `51a0b2f`, a partir de `retro.mjs collect 121 --apply`
(`.spectree/retros/retro-synd-guardas.signals.json`), na mudança seguinte (51).

## O que foi lido

O registro da coleta:
- três commits;
- CI verde nos três heads;
- nenhum comentário;
- a seção Atrito presente.

Nenhuma assinatura conhecida casou.

O Atrito diz que houve três rodadas de revisão. A primeira achou uma tentativa fantasma no executor,
que os testes diretos de `startWork` não cobriam.

## Achados

- **R-021 · guarda testada só pela função** · `automated-checks · executor ·
  guarda-testada-so-pela-funcao` · a guarda nova foi provada chamando `startWork` direto. O caminho
  pelo executor, que registra a tentativa antes, só apareceu na revisão. Primeira ocorrência.

## O que funcionou

O revisor em contexto limpo pegou o caminho que os testes não cobriam antes do merge, e o PR
mergeou sem CI vermelha.
