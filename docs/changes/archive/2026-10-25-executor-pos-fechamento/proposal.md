# Executor de tarefas depois do fechamento preparado

Tarefa 32, autorizada pelo Gilson em 2026-10-25 a partir do relatório do Invoker do SYND sobre o
tempo do pass 2 (discovery em `/mnt/project-files/analysis/tempo-pass2-synd.md`). Primeira de três
mudanças em série. Release: v1.71.0.

**Mudança deltaless.** Esta mudança não carrega delta em `specs/`. Ela corrige o executor de tarefas
do runtime do squad; o comportamento dos projetos consumidores não muda.

## Problema

O pass 2 ataca o fechamento preparado (regra da 1.54.0), e a preparação move `docs/changes/<id>/`
para `docs/changes/archive/`. Os achados do pass 2 chegam com a change em `implemented`. Nesse ponto o
executor falhava em duas camadas:

1. As referências das tarefas, declaradas em `docs/changes/<id>/`, eram lidas no caminho literal:
   `tasks.mjs status`, `repair` e `verify` recusavam com `E_WORK_REFS`. O digest do contrato, no
   mesmo executor, já seguia a pasta arquivada.
2. `repair` e `verify` só aceitavam a change antes de `implemented`. Com as referências corrigidas,
   a recusa passava a ser `E_TASK_GATE`.

No SYND (change passkeys), as correções do pass 2 tiveram de ir à mão para um Developer, fora do
orçamento de tentativas e da trilha do executor.

## Escopo

1. **Referências seguem a pasta arquivada.** O plano guarda os caminhos como foram declarados; os
   bytes são lidos onde a change está agora, pela mesma regra do digest do contrato. O pacote de
   contexto e o `required_reading` do despacho apontam o caminho arquivado.
2. **`repair` e `verify` aceitos em `implemented`.** Nada avança estado nem toca aprovação; um `run`
   comum segue exigindo a change antes de `implemented`, e depois de `pass2_complete` o executor
   segue fechado. A janela só abre quando o planner espera o pass 2 ou a preparação dele: autoridade
   ilegível, operação de fechamento pendente, problema de entrega ou aprovação faltando a mantêm fechada.
3. **O núcleo diz que os achados do pass 2 passam por `tasks.mjs run/repair`.**
4. **Teste discriminante**, `tests/task-executor-closure.test.mjs`: vermelho no código do #103 com
   `E_WORK_REFS`, e de novo vermelho com `E_TASK_GATE` quando só a primeira camada é corrigida.
5. A retro de `painel-plano` (#103), devida por esta.

## Fora do escopo

- A rodada incremental do pass 2 e o harness do plugin: mudanças 33 e 34 desta série.
- O orçamento de tempo do despacho do pass 2 vai para a mudança `orcamento-de-contexto`.

## O que esta mudança deve e não paga

- D-020: pass 2 por tarefa durante a execução, adiado porque contradiz a regra da 1.54.0.
- D-021: uma correção pedida depois de `pass2_complete` (CI vermelho) segue fora do executor.
- Só as referências e os arquivos de aceitação seguem a pasta arquivada; um `check.command` que cite
  um caminho de `docs/changes/<id>/` no argv roda o caminho literal. Nenhum plano conhecido faz isso.
