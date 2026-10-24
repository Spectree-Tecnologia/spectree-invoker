# Piso do Node nos projetos consumidores

Tarefa 14, autorizada pelo Gilson em 2026-10-24, a terceira entrega da frente de segurança.
Fecha o que o D-015 registrou. Release: v1.52.0.

**Mudança deltaless.** Este repositório não tem specs vivos. O comportamento novo do
`capabilities.mjs` é provado pelos testes desta mudança, e o resto da suíte segue verde.

## Problema

A tarefa 12 subiu o piso de `engines.node` para as versões com as correções de 2026-10-21 e ligou
`engine-strict`. Isso vale para quem instala este pacote com npm. Um projeto consumidor recebe os
scripts pelo instalador e roda o squad no Node que tiver: num Node 22.22.0, a Presence decodifica
respostas da API da OpenAI com o Brotli vulnerável e ainda confia nas chaves da eMudhra, sem aviso.
O `capabilities.mjs`, que é o relatório que o Invoker roda antes de prometer qualquer coisa, só
relatava a versão.

## Escopo

1. `satisfiesFloor` em `scripts/lib/shared/runtime.mjs`, publicado pela entrada do `shared`. Lê o
   piso de um lugar só, o `engines.node` do `package.json` do próprio pacote, que o instalador já
   leva para o consumidor. Entende só `^x.y.z` e `>=x.y.z` unidos por `||`; qualquer outra forma é
   `null`, nunca "atende".
2. `capabilities.mjs` ganha o fato `runtime.floor`: `met`, `BELOW FLOOR` (VERIFIED, com a instrução
   de atualizar o Node) ou `unknown` (sem piso ou piso não entendido). Abaixo do piso, o relatório
   em texto termina com uma NOTE. O relatório continua só relatando: não recusa rodar.
3. `tests/ci-security.test.mjs` passa a usar a mesma função para o piso, e prova num consumidor
   instalado de verdade os três casos (`met`, `BELOW FLOOR`, `unknown`). O caso do consumidor foi
   visto vermelho com o `capabilities.mjs` da `main`.

4. Retro da tarefa 13 (`checagens-por-relatorio`, #84), devida por esta mudança, coletada com
   `retro.mjs collect 84`.

## Fora do escopo

- Recusar rodar abaixo do piso. Um script que se recusa a rodar trava a sessão que mais precisa
  do relatório para descobrir o que atualizar; a decisão de parar continua do Invoker.
- O Node das sessões em nuvem deste projeto (R-008), que é configuração do ambiente.

## O que esta mudança deve e não paga

D-015 entregue; continua aberto só porque fechar exige evidência observada (D-009).
