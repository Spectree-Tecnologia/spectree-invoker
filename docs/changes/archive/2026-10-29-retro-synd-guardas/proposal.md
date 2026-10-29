# Guardas da retro do SYND: módulos na abertura e rodada do pass 2 antes do reparo

Tarefa 49, autorizada pelo Gilson em 2026-10-29 a partir da retro do SYND (triagem em
`/mnt/project-files/analysis/retro-synd-executor-cota.md`, itens 3 e 4). Segunda de três mudanças em
série. Release: v1.88.0.

**Mudança deltaless.** Esta mudança não carrega delta em `specs/`. Ela adiciona duas recusas ao
runtime do squad; o produto dos projetos consumidores não muda.

## Problema

1. **Change aberta sem `--modules`.** `state.mjs open` aceitava uma change sem módulos nomeados e sem
   `--deltaless`. A exigência de mutante morto do core domain, o contrato entre proposta e delta e a
   política de escopo leem os módulos nomeados, então uma change que não nomeia nenhum passava pelas
   três sem dizer nada. No SYND isso só apareceu na preparação do fechamento.
2. **Rodada do pass 2 não gravada antes do reparo.** O card do Quality Engineer já manda gravar a rodada
   com `pass2.mjs record` antes de qualquer reparo, mas nada recusava o reparo. Quando a correção move
   os bytes atacados, a rodada não pode mais ser gravada (`E_PASS2_STALE`), e a rodada seguinte ataca a
   change inteira de novo. No SYND isso forçou refazer o escopo inteiro.

## Escopo

1. **`open` recusa com `E_MODULES_UNNAMED`** uma change sem `--modules` não vazio e sem `--deltaless`,
   sem gravar nada.
2. **`work.mjs start` recusa com `E_PASS2_UNRECORDED`** qualquer operação que não seja outra rodada do
   pass 2 enquanto houver uma operação `pass2` terminada como `reported_success` que não foi gravada
   nem reconciliada. Outra rodada pode começar, porque não move o conteúdo. `pass2.mjs record` marca a
   operação como gravada (evento `recorded`). O `tasks.mjs run/repair` passa pela mesma recusa.
3. **Rodada gravada antes da marca.** Uma rodada publicada por uma versão anterior, ou por um registro
   interrompido entre as duas escritas, é marcada ao ser gravada de novo, sem virar uma segunda rodada.
   Uma rodada cujo conteúdo já mudou sai com `work.mjs reconcile`.
4. **Testes discriminantes** em `tests/cli-cycle.test.mjs` e `tests/pass2-coverage.test.mjs`,
   vermelhos no código do #119. Os testes que abriam changes sem módulos passam a nomear o módulo da
   fixture ou a declarar `--deltaless`.
5. A retro de `executor-cota-estruturada` (#119), devida por esta.

## Fora do escopo

- A regra multi-caminho no card do Architect: mudança 50.
- O contador do script de evidência e a flag de independência (item 6 da triagem): falta saber qual
  script foi usado.
- O prepush instalado como hook `pre-push`: é do SYND.

## O que esta mudança deve e não paga

- Uma change aberta numa versão anterior sem `--modules` continua como está; a recusa vale para as novas.
- Um consumidor no meio de um pass 2 com rodada terminada e não gravada é recusado no próximo `start`;
  a saída é gravar a rodada ou reconciliá-la.
