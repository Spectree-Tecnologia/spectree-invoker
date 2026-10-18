# Módulos do runtime com entrada publicada

Tarefa 4 do [ciclo de modularização do repositório](../../../ROADMAP.md#ciclo--o-repositório-seguindo-a-própria-arquitetura).
Fecha, em código, o D-004 do [ledger](../../../DEFERRED.md).

**Mudança deltaless.** Nenhum comportamento observável do runtime, dos CLIs ou do instalador
muda. Esta mudança não carrega delta em `specs/`. O critério de saída é a suíte existente verde,
sem expectativa enfraquecida, mais o teste de grafo novo.

## Problema

`scripts/lib/` tinha 41 arquivos soltos, e qualquer um importava qualquer outro. Agrupados por
capacidade, o grafo tinha ciclos: `evidence ↔ closure` e `execution ↔ closure`, os dois pelo
`withAuthority` de `lifecycle.mjs`. Nada impedia um import profundo entre capacidades.

## Escopo

1. Sete módulos, um por pasta em `scripts/lib/`:
   - `shared`: o núcleo da tarefa 2 mais `digest`, `launch`, `validate`, `harness`, `gh`, `tap`,
     `process-supervisor`, `process-worker` e `process-job.*`;
   - `change`: `store`, `state-machine`, `scope-policy`, `planner`, `planner-ci`, `work`,
     `run-events`, `lifecycle` e `core-domain`;
   - `evidence`: `verification`, `mutation`, `diff`, `ci-policy` e os três `delivery*`;
   - `execution`: `context`, `task-executor`, `agent-runner` e `bridge-mailbox`;
   - `closure`: `closure`, `closure-prep`, `reconciliation`, `project-diagnostics` e `adoption`;
   - `evaluation`: `agent-evals`, `flow-evals` e `engineering-reports`;
   - `console`: os quatro `console-*`, sem o prefixo.
2. Cada módulo tem um `index.mjs` que reexporta só os nomes que outro módulo, um CLI, o
   Presence ou o benchmark usa. Entre módulos, os imports passam pelo `index.mjs`. Dentro do
   módulo, os arquivos se importam direto.
3. O grafo fica assim, sem ciclo:
   `shared ← change ← evidence, execution ← closure ← console, evaluation`.
4. Os CLIs continuam em `scripts/*.mjs`, com os mesmos nomes e argumentos. Só os imports
   mudam.
5. O instalador do Codex copia módulos inteiros. A `RUNTIME_LIBS` virou `RUNTIME_MODULES`.
6. `tests/module-graph.test.mjs` falha nestes casos:
   - um arquivo solto em `scripts/lib/`;
   - um módulo sem `index.mjs`;
   - um `index.mjs` que reexporta outro módulo;
   - um import profundo entre módulos, ou de um CLI, do Presence, do benchmark ou dos evals;
   - um ciclo no grafo;
   - o `shared` dependendo de outro módulo.

   As guardas são mostradas rejeitando a forma antiga antes de valer.

## Decisões

- **O `lifecycle.mjs` inteiro foi para `change`.** O roadmap previa tirar só o `withAuthority`.
  Mas ele depende da leitura do controle, da operação pendente e do lock do mesmo arquivo, e
  separá-lo espalharia a fronteira de lock por dois módulos. O controle de fechamento é estado
  persistido da mudança, e por isso mora junto do `store`. Os dois ciclos somem com esse
  movimento.
- **`core-domain` fica em `change`.** É uma política lida do disco a cada transição, como a
  `scope-policy`.
- **Sem pasta `internal/`.** O `index.mjs` é a entrada publicada, e todo o resto da pasta é
  interno por posição. O teste garante isso, e uma pasta a mais só alongaria os caminhos.
- **Os testes importam arquivos direto.** Eles são caixa-branca e testam funções que nenhum
  outro módulo usa. A regra de entrada publicada vale para o runtime e para quem o consome.
- **Comentários e documentos que citavam `lib/<arquivo>.mjs`** passaram a citar o caminho
  novo. A pasta da tarefa 3 foi arquivada como estava.

## Ajustes em testes, e por quê

- Os imports dos testes e das fixtures apontam para os caminhos novos. Nenhuma asserção mudou.
- O teste `5e2`, que confere que o instalador não leva as UIs, agora também recusa uma pasta
  `console`. Antes ele só olhava o prefixo `console-`, que deixou de existir. Isso deixa o
  teste mais estrito.
- `tests/app-boundaries.test.mjs` reconhece a Console pela pasta `scripts/lib/console/`, e
  ganhou uma guarda para o import `../console/index.mjs`.

## Ausências declaradas

- Um consumidor que já tinha uma versão instalada fica com os arquivos antigos e soltos em
  `.spectree/squad/scripts/lib/`. O instalador nunca apagou arquivos, e esta mudança não muda
  isso. Os arquivos novos não importam os antigos.
- Os CLIs grandes (`prepare-closure`, `state`, `post-merge`) continuam carregando regra. Tirar
  essa regra deles é a tarefa 5.
- O D-004 continua aberto no ledger, porque fechar exige evidência observada (D-009).

## Critério de saída

- `tests/module-graph.test.mjs` verde aqui e com 3 de 6 testes vermelhos na base `9041d5a`.
- `build.mjs --check`, `check-plugin.mjs`, `delivery.mjs ledger` e a suíte completa verdes.
- O teste `5e2` verde: tudo o que é instalado resolve seus imports no consumidor.
