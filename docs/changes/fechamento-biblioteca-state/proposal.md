# Comandos de estado como biblioteca

Tarefa 5b do [ciclo de modularização do repositório](../../ROADMAP.md#ciclo--o-repositório-seguindo-a-própria-arquitetura).
Avança o D-005 do [ledger](../../DEFERRED.md), na parte do `state.mjs`, e entrega em código o D-010.
O `post-merge.mjs` vem na mudança seguinte.

**Mudança deltaless, com uma correção declarada.** Este repositório não tem especificação viva, e
esta mudança não carrega delta em `specs/`. Um comportamento observável muda, e só um: o `init`
deixa de ler como opção sua o que vem depois do `--` (D-010). Todo o resto (comandos, argumentos,
saída e códigos de saída) continua igual. O critério de saída é a suíte existente verde, sem
expectativa enfraquecida, mais os testes em processo novos.

## Problema

O `state.mjs` tinha 885 linhas. Os comandos ficavam num `switch` de nível de módulo que terminava
em `process.exit`, e por isso cada teste de comando precisava subir um processo. O `init` lia as
flags no `argv` inteiro. Um comando de consolidação com `--repository` ou `--ci-workflow` entre os
seus argumentos mudava a configuração do projeto.

## Escopo

1. O corpo do CLI vira `stateCommand({ root, argv, out, err })` em `scripts/lib/closure/state.mjs`,
   publicado pelo `index.mjs` do `closure`, e devolve o código de saída.
2. Cada `case` do `switch` vira uma função (`initCommand`, `transitionCommand`, `runCommand`…),
   despachada por nome numa tabela. `can` e `transition` dividem uma função, e o mesmo vale para
   `record-evidence`, `record-approval` e `defer`, como já dividiam o `case`.
3. As saídas viram `Exit`, como no `prepare-closure`. O único `catch` que envolvia uma recusa, o
   das importações, devolve o `Exit` em vez de engolir a recusa.
4. O `init` lê as flags só antes do `--`. `docs/workflow.md` diz isso onde mostra a declaração do
   comando.
5. O CLI fica com o cabeçalho de uso e uma chamada: `process.exitCode = stateCommand(...)`.
6. `tests/state-library.test.mjs` chama a função no mesmo processo, com a raiz do projeto fora
   do diretório de trabalho, e cobre:
   - o D-010, que falha na base;
   - o `init` sem `--`;
   - o comando desconhecido;
   - `open`, `can`, `transition`, `trail`, `resume` e `validate`;
   - uma recusa de importação que chega com a própria mensagem.

## Decisões

- **Os comandos ficam no módulo `closure`.** Eles leem a preparação e o controle de fechamento, e
  `closure` é o único módulo que enxerga `change`, `evidence` e `execution` ao mesmo tempo sem
  ciclo.
- **O stderr do git continua indo direto para o terminal**, como sempre foi no `state.mjs`. A
  função não o captura.
- **O D-010 entra aqui e não numa mudança própria.** A correção é uma linha na leitura das flags,
  e a função nova é o ponto onde essa leitura passa a ficar num só lugar.
