# Mutações em lote

Tarefa 17, autorizada pelo Gilson em 2026-10-24: o item 5 da análise do custo de verificação do
SYND C3a. Release: v1.55.0.

**Mudança deltaless.** Esta mudança não carrega delta em `specs/`. Um plano de uma mutação continua
aceito e devolve o mesmo resultado de antes; o que entra é a forma em lote.

## Problema

O `mutation-probe.mjs` fazia uma cópia, um setup, uma baseline e um mutante por mutação. No SYND
C3a, 75 mutações deram 150 execuções da suíte e 75 setups, perto de 10 horas de pass 2. O card do
Quality Engineer não dizia quanto é proporcional.

## Escopo

1. **Retro da tarefa 16** (`congelamento-antes-do-pass2`), devida por esta mudança, coletada com
   `retro.mjs collect 87`.
2. **Plano em lote:** `mutations` lista de 1 a 200 mutações com `id` único, `target`, `before`,
   `after` e `test_name`. Todas compartilham um `command`, um `setup_command` e um `timeout_seconds`,
   e rodam numa cópia, com um setup e uma baseline em que todo teste nomeado passa. Cada mutante é
   aplicado à cópia intacta, roda e é revertido antes do próximo. A cópia é conferida contra o
   candidato depois de cada um.
3. **`mutant_command`** pode trazer `{test_name}`, para cada mutante rodar só o teste que deve
   matá-lo.
4. **O resultado do lote:** um sobrevivente reprova o lote e é nomeado; um mutante inconclusivo
   nunca conta como morto.
5. **O card do Quality Engineer** diz quanto é proporcional: uma mutação morta por regra nova ou
   alterada, não uma por linha, com todas as mutações da change num lote só. `docs/reliability.md`
   documenta o formato.

## Fora do escopo

Lotes em paralelo com namespaces separados. Uma baseline só já tira a metade das execuções, e
rodar em paralelo exige que o projeto isole recursos por `SPECTREE_TEST_NAMESPACE`, que é decisão
de cada consumidor.

## O que esta mudança deve e não paga

Nada novo no ledger. O núcleo não muda.
