# Correção dos achados da primeira auditoria de código

Tarefa 52, autorizada pelo Gilson em 2026-10-29 ("Sim, change separada depois", no cartão de decisão
da tarefa 51). Release: v1.91.0.

**Mudança deltaless.** Não há delta em `specs/`. Ela corrige três scripts do runtime do plugin e a
documentação de instalação; nenhum `Scenario` de projeto consumidor muda.

## Problema

O piloto da `security-audit` sobre `fa64575` deixou três registros `needs_validation`, adiados na
tarefa 51 com dono `own_change`:

- **D-027:** `install-codex.mjs` confere a contenção só pelo texto do caminho, então um `AGENTS.md`
  ou `.spectree` commitado como symlink leva a escrita para fora do projeto.
- **D-028:** `state.mjs record-evidence` aceita `code_fingerprint` e `neutral_paths`, e um `ci.green`
  importado com eles passa como medida carregada do conteúdo atual.
- **D-029:** a observação do Console roda `git` pelo nome puro com `cwd` na raiz do projeto; um
  `git` do projeto pode rodar antes das recusas de fsmonitor e filtros.

## Escopo

1. Primeiro o teste: `tests/security-audit-fixes.test.mjs`, com os quatro casos falhando em
   `68e6aeb`.
2. D-027: `install-codex` recusa, no dry run e no `--apply`, todo componente symlink entre a raiz do
   projeto e cada destino, nomeando cada um, antes de escrever qualquer coisa.
3. D-028: `record-evidence` recusa `code_fingerprint` e `neutral_paths`, como já recusava
   `fingerprint` e `contract_digest`.
4. D-029: `gitExecutable` no helper compartilhado resolve `git` para um caminho absoluto, só de
   entradas absolutas do `PATH` fora do projeto (no Windows, só `.exe` ou `.com`); o helper `git()` e
   as três chamadas da observação do Console passam a usá-lo.
5. `docs/install.md` diz que o symlink é recusado; D-027 a D-029 registram a entrega.
6. A retro de `auditoria-de-codigo` (#122).

## Fora do escopo

- As outras execuções de `git` puro sobre raízes de projeto (variantes do D-029). Estão no D-030, que
  pede uma nova rodada da auditoria antes de qualquer correção.
- Os itens de endurecimento do relatório do piloto.

## O que esta mudança deve e não paga

- D-027 a D-029 continuam abertos: fechar exige evidência observada, que este repositório ainda não
  registra (D-009). A entrega e o teste estão citados em cada um.
- Desvio no D-028: a condição pedia também recusar `source_kind: observed_execution`. Ficou aceito
  (`tests/cli-cycle.test.mjs` fixa isso). O documento é gravado como veio e ainda conta nos gates que
  não exigem evidência fresca; esta mudança tirou só o caminho `carried`. O resto segue devido no
  D-028.
- O D-029 foi corrigido no helper `git()` e na observação do Console. Outras sete execuções de `git`
  puro sobre a raiz do projeto, levantadas na revisão, estão listadas no D-030.
- O teste do D-029 roda em POSIX. No Windows, a ordem de busca do libuv segue não observada; a
  correção não depende dela, porque o spawn recebe um caminho absoluto.
