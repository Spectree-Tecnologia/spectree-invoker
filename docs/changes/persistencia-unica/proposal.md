# Uma camada de persistência só, com a ordem de lock

Tarefa 5d do [ciclo de modularização do repositório](../../ROADMAP.md#ciclo--o-repositório-seguindo-a-própria-arquitetura).
Entrega em código o D-006 do [ledger](../../DEFERRED.md), a última parte da tarefa 5.

**Mudança deltaless.** Nenhum comportamento observável muda: mesmos registros em `.spectree/`,
mesmos códigos de recusa. Esta mudança não carrega delta em `specs/`. O critério de saída é a
suíte existente verde, sem expectativa enfraquecida, mais os testes novos da camada.

## Problema

Cada escritor de `.spectree/` gravava do seu jeito. O `store` e o `lifecycle` tinham cada um o
seu lock e o seu `writeAtomic`. O executor de tarefas tinha um terceiro lock e um terceiro
`atomic`. O `reconciliation` e o `bridge-mailbox` publicavam registros imutáveis com o mesmo
temp e `link` escritos duas vezes. Uns dez arquivos criavam registros com `{ flag: 'wx' }` direto.
A ordem dos locks (controle de fechamento antes da mudança) existia só em comentário.

## Escopo

1. `scripts/lib/shared/persistence.mjs` passa a ter as três formas de gravar um registro e o
   lock, publicados pelo `index.mjs` do `shared`:
   - `writeAtomic` substitui um documento inteiro;
   - `writeOnce` cria um registro que não pode existir ainda;
   - `publishOnce` cria um registro que não pode existir ainda e nunca pode ser lido pela metade;
   - `withLock(kind, file, fn, opts)` executa a seção crítica sob um lock de criação exclusiva.
2. `LOCK_ORDER` é `executor → lifecycle → change → deferred`. O `withLock` recusa com
   `E_LOCK_ORDER` um lock pedido dentro de outro que vem depois dele na ordem, ou do mesmo tipo.
3. `store`, `lifecycle` e o executor de tarefas usam o `withLock`, cada um com a sua recusa de
   sempre (`E_CONCURRENT_UPDATE`, `E_TASK_BUSY`) e a sua política de lock abandonado.
4. Os outros escritores (`work`, `run-events`, `delivery`, `delivery-ledger`, `adoption`,
   `reconciliation`, `agent-runner`, `bridge-mailbox`, `process-supervisor`, `process-worker`)
   gravam pelas três funções.
5. `tests/persistence.test.mjs` cobre a ordem, a liberação depois de um erro, a recusa do
   chamador, as três gravações e uma guarda: nada em `scripts/lib/` grava com `'wx'`, `link` ou
   `rename` fora da camada.

## Decisões

- **A ordem é verificada, não descrita.** Dois escritores que pegam o mesmo par de locks em
  ordem oposta podem esperar um pelo outro para sempre. Recusar a segunda ordem no momento em
  que ela é tentada torna isso impossível, e não só improvável.
- **A recusa continua sendo de quem chama.** O `withLock` recebe `busy`, e cada escritor mantém a
  mensagem e o código que os testes e os operadores já conhecem.
- **Um `rename` fica fora da camada:** o arquivamento da pasta da mudança em `docs/`, que move uma
  pasta e não grava um registro de `.spectree/`. A guarda nomeia essa exceção.
- **O `writeOnce` não cria o diretório.** Todos os chamadores já preparavam o lugar, e um registro
  que cai onde ninguém preparou é uma recusa.
