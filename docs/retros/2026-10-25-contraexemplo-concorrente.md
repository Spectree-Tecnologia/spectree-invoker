# Retro — contraexemplo-concorrente (#105, v1.74.0)

Change: `contraexemplo-concorrente`

Escrita em 2026-10-25, depois do merge `4b04951`, a partir de `retro.mjs collect 105 --apply`
(`.spectree/retros/contraexemplo-concorrente.signals.json`), na mudança seguinte (36).

## O que foi lido

O registro da coleta: um commit depois do rebase, um head de CI, todos os runs completos e verdes,
nenhum comentário, PR aberto por 45 minutos porque o merge esperou as tarefas 33 e 34, seção Atrito
presente e o release v1.74.0 nomeado pela proposta arquivada. Revisão independente em três heads,
nenhum achado Importante; três Nits ficaram no PR, todos no lado estrito.

## Achados

- **R-004 · 5 · checagens automáticas** · `automated-checks · protocol · teto-sem-folga` · o card do
  Architect estava a 549 bytes do teto e o núcleo a 130; a frase do núcleo foi escrita para caber, e a
  mudança seguinte (36) deixou a regra do brief do pass 2 fora do núcleo, no comando e no perfil, porque
  sobravam 58 bytes. Segue aberto no [D-013](../DEFERRED.md); a mudança própria segue devida.
- **R-013 · 2 · acesso à informação** · `information-access · ambiente · dependencias-nao-instaladas` ·
  a sessão começou de novo sem `npm ci`, e o Presence ficou vermelho até instalar. Fica aberto, primo do R-008.

## O que funcionou

O rebase depois da série trocou versão e retro sem tocar no código, e a revisão por head confirmou
que o diff da regra era o mesmo antes e depois.
