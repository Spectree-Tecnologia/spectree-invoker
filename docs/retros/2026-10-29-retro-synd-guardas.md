# Retro — retro-synd-guardas (#121, v1.88.0)

Change: `retro-synd-guardas`

Escrita em 2026-10-29, depois do merge `51a0b2f`, a partir de `retro.mjs collect 121 --apply`
(`.spectree/retros/retro-synd-guardas.signals.json`), na mudança seguinte (50).

## O que foi lido

O registro da coleta:
- três commits;
- CI verde nos três heads;
- nenhum comentário;
- a seção Atrito presente.

Nenhuma assinatura conhecida casou.

## Achados

- **R-021 · guarda testada só na função** · `automated-checks · executor · guarda-testada-so-na-funcao`
  · os primeiros testes da recusa `E_PASS2_UNRECORDED` chamavam `startWork` direto. A primeira rodada
  de revisão achou que o executor salvava a tentativa antes de chamar `startWork`, então a recusa
  gastava orçamento. O teste do caminho do executor só entrou depois. Primeira ocorrência.

## O que funcionou

A revisão independente rodou uma mutação em cima da correção: tirou a guarda do executor e confirmou
que o teste novo a pegava.
