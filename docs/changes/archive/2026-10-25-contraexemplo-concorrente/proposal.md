# Contraexemplo concorrente no plano de verificação

Tarefa 35, autorizada pelo Gilson em 2026-10-25 a partir dos desvios da retro da change passkeys do
SYND (discovery em `/mnt/project-files/analysis/retro-passkeys-desvios.md`). Release: v1.74.0.

**Mudança deltaless.** Esta mudança não carrega delta em `specs/`. Ela muda o desenho do plano de
verificação que o Architect escreve; o comportamento dos projetos consumidores não muda.

## Problema

Na change passkeys do SYND, três dos cinco defeitos que o pass 2 achou eram corridas: duas escritas
simultâneas furando uma regra de unicidade ou de contador. Nenhuma estava no plano. A lente de
concorrência só existe no pass 2 (card do Quality Engineer), e o plano aceita qualquer contraexemplo:
um contraexemplo sequencial passa contra um "verifica e depois insere" que a segunda requisição quebra.
O pass 1 não escreve o teste, o Developer não implementa a proteção, e a corrida chega no fim.

## Escopo

1. **`verification.mjs plan` exige `concurrent_invariants` num plano em desenho.** A lista declara
   cada regra de unicidade ou de contador (`kind`, `invariant`, `scenario_refs`, `check_id`), ou vem
   vazia, dito explicitamente. Ausente, a recusa é `E_PLAN_CONCURRENCY`.
2. **A regra declarada é provada por um check concorrente.** O check nomeado é `behavior` e tem
   `counterexample_kind: "concurrent"`, sobre os mesmos Scenarios da regra; senão `E_CONCURRENT_CHECK`. Entrada malformada é
   `E_CONCURRENT_INVARIANT`; `counterexample_kind` só aceita `sequential` ou `concurrent`.
3. **Plano arquivado não é redesenhado.** Um plano sob `docs/changes/archive/` e as leituras internas
   (`checks`, `delivery`) não exigem a lista; quando ela está presente, segue cobrada. "Arquivado" é
   lido pelo caminho relativo ao projeto, nunca pelo caminho absoluto.
4. **Regra no núcleo, no card do Architect e no `protocol-rationale.md`**, com os dois exemplos de
   `docs/examples/` atualizados.
5. **Testes discriminantes** em `tests/verification-plan.test.mjs`, vistos vermelhos sem o código.
6. A retro de `harness-pass2` (#107), devida por esta.

## Fora do escopo

- O despacho do pass 2 com declaração de independência e escopo final: mudança 36, `despacho-pass2`.
- A detecção do navegador em `capabilities.mjs`: proposta, não autorizada.
- O padrão de teste de navegador sem corrida e o D-034 do SYND: disciplina do projeto consumidor.

## O que esta mudança deve e não paga

- D-022: o runtime prova que cada regra declarada tem um check concorrente, não que o Architect
  declarou todas as regras de unicidade ou de contador, nem que o teste nomeado corre de fato duas
  escritas em paralelo. A classificação continua sendo leitura, e a lente do pass 2 fica como rede.
