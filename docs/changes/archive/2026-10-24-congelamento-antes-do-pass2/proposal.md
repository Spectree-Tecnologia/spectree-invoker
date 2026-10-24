# Pass 2 só sobre o fechamento preparado

Tarefa 16, autorizada pelo Gilson em 2026-10-24: o item 4 da análise do custo de verificação do
SYND C3a. Release: v1.54.0.

**Mudança deltaless.** Esta mudança não carrega delta em `specs/`. O protocolo já manda preparar o
fechamento antes do pass 2 (§7.4); o que muda é que o runtime passa a cobrar isso.

## Problema

No SYND C3a, o pass 2 rodou antes de os caminhos, o DEFERRED e a documentação estarem fechados.
Quando o README entrou, o conteúdo mudou e o pass 2 precisou rodar de novo. Até aqui, o gate só
exigia a preparação do fechamento em `integration_approved`. O planner já recomendava preparar
antes do pass 2, mas nada impedia registrar o pass 2 sem ela.

## Escopo

1. **Retro da tarefa 15** (`evidencia-neutra`), devida por esta mudança, coletada com
   `retro.mjs collect 86`.
2. **`pass2_complete` exige a preparação do fechamento** que cobre o candidato, com a mesma
   verificação de `integration_approved` (`E_CLOSURE_NOT_PREPARED`). A preparação já confere os
   caminhos permitidos, o archive e o ledger. Uma change com `closure_mode: "legacy"` continua isenta.
3. Testes: `tests/state-machine.test.mjs` cobre sem preparação, com preparação vencida, preparada e
   legada. Dois testes que chegavam a `pass2_complete` sem preparar passam a preparar antes,
   como o pipeline manda.

## Fora do escopo

Um comando `state.mjs freeze` à parte, como a análise sugeria. O `prepare-closure.mjs` em dry-run
já é esse ensaio, e o planner já o aponta em `implemented`. O que faltava era a recusa.

## O que esta mudança deve e não paga

Nada novo no ledger. O núcleo não muda.
