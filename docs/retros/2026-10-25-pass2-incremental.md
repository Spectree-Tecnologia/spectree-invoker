# Retro — pass2-incremental (#106, v1.72.0)

Change: `pass2-incremental`

Escrita em 2026-10-25, depois do merge `c8f5072`, a partir de `retro.mjs collect 106 --apply`
(`.spectree/retros/pass2-incremental.signals.json`), na mudança seguinte (34).

## O que foi lido

O registro da coleta: sete commits, um head de CI, todos os runs completos e verdes, nenhum comentário,
seção Atrito presente e o release v1.72.0 nomeado pela proposta arquivada. Nenhuma assinatura conhecida
casou na coleta. A seção Revisão independente do PR: sete rodadas antes do push, a última limpa.

## Achados

- **R-015 · 1 · padrões de revisão** · `review-standards · proposta · identidade-depois-do-codigo` ·
  a proposta não dizia o que era uma rodada, um mutante e um arquivo coberto. Cada uma das seis
  primeiras rodadas de revisão achou uma borda dessa identidade (bytes do registro e não do fim da
  rodada, rodada interrompida contada como cobertura, id de mutante reusado entre planos, modo lido do
  disco e não do índice, pathspec como glob, arquivo ilegível tratado como apagado). A seção Identidade
  só entrou na terceira rodada, pela regra do CONTRIBUTING. A tarefa 34 a escreveu antes do código.
  Fica aberto até uma segunda mudança confirmar que a ordem segura.
- **R-016 · 1 · checagens automáticas** · `automated-checks · pass2 · nits-da-revisao-final` · três Nits
  da última rodada seguem sem pagamento: `elapsed_ms` da evidência inclui o digest de depois do run, um
  caminho não canônico em `attacked` é gravado como veio, e um symlink nunca conta como coberto. Nenhum
  dá cobertura falsa; todos dão uma rodada a mais. Fica aberto.
- **R-012 · +1** · o registro de cobertura só foi exercitado em fixtures, como o trailer do #102; a
  confirmação é a primeira rodada real do SYND no v1.72.0 ou depois.

## O que funcionou

A revisão independente por head pegou seis defeitos de identidade que nenhum teste existente pegaria;
cada um entrou com o seu teste discriminante antes do push.
