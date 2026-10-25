# Retro — painel-invoker (#96, v1.63.0)

Change: `painel-invoker`

Escrita em 2026-10-25, depois do merge `7ce79e9`, a partir de `retro.mjs collect 96 --apply`
(`.spectree/retros/painel-invoker.signals.json`) e de `retro.mjs trends`, na mudança seguinte (25).

## O que foi lido

O registro da coleta: 3 commits, 3 heads de CI verdes, 10 minutos aberto, nenhum comentário, seção
Atrito presente e o release v1.63.0 nomeado pela proposta arquivada. Nenhuma assinatura conhecida
casou na coleta. `trends` antes desta retro: R-001 e R-004 recorrentes; R-008 quieto.

## Achados

- **R-011 · 1 · acesso à informação** · `information-access · mod · sem-superficie-real` · o PR
  declarou que o painel não tinha sido visto num app real, e foi no app que o Founder achou os dois
  defeitos, minutos depois do merge: o avatar infantil e o tempo de `349:56:43` numa sessão
  retomada. O `claude plugin test` desenha a árvore, não a pintura, e não simula a retomada. Pago
  em parte pela tarefa 25, que corrige os dois; o resto, ver a superfície real antes do pedido de
  merge de um mod, fica com quem abrir a próxima mudança de mod.
- **Três rodadas de revisão para Nits.** As duas pushes de correção vieram de Nits; nenhuma rodada
  achou Importante. Sem assinatura: o teto funcionou como devia.

## O que funcionou

O teste estrutural do CI pegou a troca de nome do plugin nas chaves de estado antes do primeiro
push, e o painel carregou no app do Founder sem erro de hook.
