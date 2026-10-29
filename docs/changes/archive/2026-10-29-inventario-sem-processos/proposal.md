# Inventário do executor sem os registros de processo

Tarefa 47, autorizada pelo Gilson em 2026-10-29 (OK na thread), a partir do bloqueio da C3e no SYND.
Release: v1.86.0.

**Mudança deltaless.** Esta mudança não carrega delta em `specs/`. O inventário que o executor compara
antes e depois de cada tarefa continua com o mesmo conteúdo; só deixa de quebrar e fica mais barato.

## Problema

No SYND, `tasks.mjs run` quebrou com `ENOBUFS`. A `inventory()` de `task-executor.mjs` lista o
candidato com `git ls-files --cached --others` sem `maxBuffer`, então com o limite padrão do Node, de
1 MiB. A lista do SYND já tinha 1,05 MB, quase toda feita dos 7.505 registros em `.spectree/processes`.
A função descartava todo caminho de `.spectree/` logo depois de listar. O estouro vinha de caminhos que
nunca entravam no inventário.

## Escopo

1. **`inventory()` usa o `git()` de `shared/git.mjs`** (64 MiB), como as outras chamadas de git do
   plugin.
2. **`.spectree` sai pelo pathspec** (`-- . ':(exclude).spectree'`), então o git nem percorre a pasta.
   Num repositório sintético com 1.500 arquivos de código e 7.500 registros de processo, a listagem caiu
   de 804 KB para 24 KB e de 53,8 ms para 3,3 ms por chamada. São duas chamadas por tentativa.
3. **Teste discriminante** em `tests/task-executor.test.mjs`: cerca de 1,3 MiB de caminhos em
   `.spectree/processes`; a tarefa passa e o `changed` do resultado só nomeia o arquivo da tarefa.
   Na base `fa64575`, o mesmo teste falha com `spawnSync git ENOBUFS`.
4. A retro de `avatar-espectral` (#118), devida por esta.

## Fora do escopo

- Apagar ou rotacionar `.spectree/processes`. Os registros são evidência que os registros de trabalho
  referenciam, e com a exclusão o tamanho da pasta deixa de pesar no executor.
- A listagem do Console (`console/observation.mjs`), que tem o mesmo formato com teto de 4 MiB. Fica no
  D-026.

## O que esta mudança deve e não paga

- D-026: a observação do Console lista o candidato inteiro, `.spectree/processes` incluído, com teto de
  4 MiB, e recusa acima de 50.000 caminhos.
