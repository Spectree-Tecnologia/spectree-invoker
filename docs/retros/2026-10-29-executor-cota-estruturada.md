# Retro — executor-cota-estruturada (#119, v1.87.0)

Change: `executor-cota-estruturada`

Escrita em 2026-10-29, depois do merge `fc74344`, a partir de `retro.mjs collect 119 --apply`
(`.spectree/retros/executor-cota-estruturada.signals.json`), na mudança seguinte (49).

## O que foi lido

O registro da coleta:
- seis commits;
- CI verde nos cinco heads;
- nenhum comentário;
- a seção Atrito presente.

Nenhuma assinatura conhecida casou.

O Atrito diz que houve quatro rodadas de revisão em contexto limpo e uma volta à proposta. Diz também
que o PR foi renumerado de 47 para 48 depois que o #120 mergeou primeiro; isso já está contado no
R-001 pela retro do #120.

## Achados

- **R-020 · heurística antes do desenho exato** · `review-standards · proposta ·
  heuristica-antes-do-desenho-exato` · para achar a declaração no fim da mensagem, a primeira versão
  testava candidatos com limite: as últimas 64 chaves, depois o início de cada linha. Cada rodada de
  revisão achou uma declaração legítima fora dos candidatos. Na terceira, o teto do `CONTRIBUTING`
  mandou voltar à proposta, e o desenho virou uma localização exata e linear. Primeira ocorrência.
- **R-012 · fixture sem run real** · `information-access · executor · fixture-sem-run-real` · a
  correção foi provada em fixtures dos dois harnesses e num fuzz de 20.000 declarações, não num run
  real do SYND. Quarta ocorrência; a confirmação é a próxima tentativa de T-HTTP no consumidor.

## O que funcionou

Um revisor novo a cada head achou casos diferentes a cada vez, e o fuzz contra a base provou que
nenhuma declaração aceita antes deixou de ser aceita.
