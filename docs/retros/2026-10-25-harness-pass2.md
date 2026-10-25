# Retro — harness-pass2 (#107, v1.73.0)

Change: `harness-pass2`

Escrita em 2026-10-25, depois do merge `ba64501`, a partir de `retro.mjs collect 107 --apply`
(`.spectree/retros/harness-pass2.signals.json`), na mudança seguinte (35).

## O que foi lido

O registro da coleta: cinco commits, um head de CI, todos os runs completos e verdes, nenhum comentário,
seção Atrito presente e o release v1.73.0 nomeado pela proposta arquivada. Nenhuma assinatura conhecida
casou na coleta. A seção Revisão independente do PR: quatro rodadas, três com achado Importante, a última limpa.

## Achados

- **R-015 · 2 · padrões de revisão** · `review-standards · proposta · identidade-depois-do-codigo` ·
  a tarefa 34 escreveu a seção Identidade antes do código, como a retro do #106 pediu, mas só a metade
  *o que é uma entrada*; a metade *em quem a entrada confia* (dono da pasta, link, cadeia de links) não
  estava, e três rodadas de revisão pagaram isso (`/tmp` compartilhado, symlink com alvo fora, cadeia
  passando o check textual). Segunda recorrência: pede mudança própria pelo item `retro-melhorias`,
  que diga na proposta as duas metades da identidade de toda entrada lida de fora do checkout.
- **R-016 · 2 · checagens automáticas** · `automated-checks · pass2 · nits-da-revisao-final` · três Nits
  da última rodada seguem sem pagamento: a marca da entrada não é rechecada depois da cópia, o doc não
  diz que no Windows só as checagens de link e pasta valem, e `containedBy` compara texto, não realpath,
  para `SPECTREE_PROBE_CACHE`. Nenhum abre uma entrada plantada pelo caminho padrão. Fica aberto.
- **R-012 · +1** · o cache de instalação só foi exercitado em fixtures; a confirmação é a primeira prova
  de mutação do SYND no v1.73.0 ou depois.

## O que funcionou

Cada achado Importante entrou com o seu teste discriminante antes do push, e a revisão por head parou
no primeiro head limpo.
