# Harness do pass 2: cache de instalação da prova de mutação

Tarefa 34, autorizada pelo Gilson em 2026-10-25 a partir do relatório do Invoker do SYND sobre o
tempo do pass 2. Terceira de três mudanças em série. Release: v1.73.0.

**Mudança deltaless.** Esta mudança não carrega delta em `specs/`. Ela muda a prova de mutação do
runtime do squad; o comportamento dos projetos consumidores não muda.

## Problema

Cada `mutation-probe.mjs --apply` monta uma cópia descartável e roda o `setup_command` do zero, com
um `HOME` vazio: a instalação de dependências nunca aproveita nada da execução anterior. No SYND, cada
change tinha o seu harness no scratchpad, cada um reinstalando tudo, e o QE gastava parte da rodada
montando o ambiente em vez de atacar.

## Identidade

Escrita antes do código, porque a mudança anterior (#106) mostrou o custo de não fazer isso:

- **Uma entrada de cache** é o resultado de um `setup_command` que saiu com 0, restrito aos caminhos
  que o plano declarou em `setup_cache.paths`. A chave é o `setup_command`, esses caminhos, os bytes de
  cada arquivo em `setup_cache.key_files` no candidato, a plataforma, a arquitetura e a versão do Node.
  Mudou qualquer um deles, a chave é outra.
- **Um acerto** copia os bytes da entrada para dentro da cópia descartável, nunca um link. A cópia
  continua descartável: um mutante que escreva em `node_modules` não alcança a entrada.
- **A baseline roda sempre**, com ou sem acerto. Uma entrada estragada aparece como baseline vermelha,
  e o registro diz que houve acerto e qual era a chave.
- **A entrada mora fora do checkout**, em `SPECTREE_PROBE_CACHE` ou em `~/.cache/spectree-probe`.
  A pasta é privada ao usuário: outra dona, permissão aberta ou link é recusa, porque a entrada roda
  como código da prova. Pelo mesmo motivo, um link guardado na entrada fica dentro do caminho
  declarado; um que aponte para fora faz a entrada não ser gravada. Nunca entra no digest de conteúdo nem em `.spectree/`.
- **Uma entrada só existe completa.** Ela é gravada numa pasta temporária e renomeada; a marca de
  completa é o último arquivo escrito. Sem a marca, não há acerto.
- **O cache é opcional e declarado.** Sem `setup_cache` no plano, nada muda.

## Escopo

1. `setup_cache: { "key_files": [...], "paths": [...] }` no plano da prova de mutação, simples ou em
   lote, valendo só junto com `setup_command`. Um caminho declarado não pode cobrir arquivo do candidato.
2. O registro da prova diz `setup.cache`: `hit`, `miss` ou `stored`, com a chave.
3. `docs/reliability.md` troca "não há reaproveitamento de `node_modules`" pela regra acima e mostra o
   padrão de banco por template (`CREATE DATABASE … TEMPLATE`) no comando de teste do projeto (num acerto o `setup_command` não roda). O banco
   continua sendo do projeto: a prova não recebe credencial nenhuma.
4. O card do Quality Engineer manda declarar `setup_cache` quando a instalação domina o tempo da prova.
5. A retro de `pass2-incremental` (#106), devida por esta.
6. A guarda de escrita crua (`tests/persistence.test.mjs`) passa a aceitar o `renameSync` de
   `evidence/mutation.mjs`: a entrada do cache mora fora do checkout e não é registro de `.spectree/`,
   como o arquivamento de `closure/prepare.mjs`. É a única linha que a lista ganha.

## Fora do escopo

- Um `run-all` do plugin: o comando da suíte já é do projeto (`verification.json`) e a cobertura
  entre rodadas já é do `pass2.mjs`. O que sobra de harness por change é dado, não código.
- Criar e apagar o banco por mutante: o plugin não conhece o banco do projeto.
- Limpar entradas antigas do cache: é uma pasta do usuário, ou a que o operador apontou.

## O que esta mudança deve e não paga

- Os três Nits da última revisão do #106 (`elapsed_ms` com o digest de depois, caminho não canônico em
  `attacked`, symlink nunca coberto) seguem abertos; a retro do #106 os registra.
