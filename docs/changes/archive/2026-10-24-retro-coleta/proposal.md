# Retro pós-merge: coleta medida com `retro.mjs collect`

Tarefa 11b do [ciclo de modularização do repositório](../../../ROADMAP.md#ciclo--o-repositório-seguindo-a-própria-arquitetura),
autorizada pelo Gilson em 2026-10-24, logo depois do merge da tarefa 11. Release: PR #80 / v1.47.0.

**Sem delta em `specs/`.** Este repositório não tem specs vivos; o comando novo é provado pelos
testes desta mudança, e o resto da suíte segue verde.

## Problema

A retro da tarefa 11 e o piloto foram coletados à mão: listar PRs, cruzar runs de CI por branch e
janela, ler o assunto de cada commit extra, contar os archives. Isso custou turnos e errou uma
contagem (R-002 saiu 9 e era 12). No harness em nuvem, `gh pr view` é recusado porque usa GraphQL.

## Escopo

1. `scripts/retro.mjs collect <pr> [--repo owner/name] [--apply]`, uma fachada fina sobre
   `retroCommand` em `scripts/lib/evaluation/retro.mjs`. Ela lê:
   - o PR pela API REST (`pullRequestRecord` em `scripts/lib/shared/gh.mjs`);
   - os commits do merge, os proposals que o merge arquivou e a versão no commit do merge, pelo git;
   - os runs de CI de cada commit, por identidade (`runsForCommit`);
   - a seção **Atrito** do corpo do PR.
2. A saída são sinais medidos e as assinaturas conhecidas que casaram: identificador disputado
   (R-001), fechamento depois do merge (R-002), rastro ausente (R-003) e CI vermelho no PR. O que não
   foi medido fica `null` ou `ci_runs_complete: false`, nunca zero.
3. `--apply` grava `.spectree/retros/<slug>.signals.json` com `publishOnce` e recusa
   `E_RETRO_EXISTS` se o registro já existe. Outras recusas: `E_RETRO_NOT_MERGED`,
   `E_RETRO_MERGE_UNKNOWN`, `E_RETRO_REPO`.
4. A skill `squad-closure-retro` manda começar pelo comando; o instalador do Codex o entrega, e
   `check-plugin` exige o comando e a biblioteca.
5. A retro da tarefa 11 (`docs/retros/2026-10-24-retro-pos-merge.md`), feita com o próprio comando.

## Fora do escopo

- O modo estruturado (ler `.spectree/runs/`, handoffs recusados e tentativas) espera o D-009.
- O gatilho no runtime (`retro.recorded`, planner e `E_RETRO_PENDING`) e as tendências
  (`retro.mjs trends`) são as fatias 11c e 11d.
- Commits reescritos antes do merge não aparecem no git; os runs deles também não são contados.
  A seção Atrito é o lugar de registrar esse atrito.

## Prova

Rodado contra os PRs reais: o #63 casa identificador disputado, fechamento depois do merge e rastro
ausente; o #78 casa os dois últimos; o #79 não casa nada.
