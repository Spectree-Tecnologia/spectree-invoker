# Retros

Uma retro por mudança integrada, escrita depois do merge, na mudança seguinte. Ela segue a squad
skill [`squad-closure-retro`](../../skills/squad-closure-retro/SKILL.md): lê o rastro da mudança,
ordena os achados por severidade e dá um dono a cada um. A retro registra e não corrige nada no
lugar; cada correção entra por uma mudança própria.

## Regras deste repositório

- **Um arquivo por mudança:** `docs/retros/<data>-<slug>.md`, com a linha `Change: \`<slug>\``.
  A partir de 2026-10-24, toda mudança arquivada tem a sua retro, menos a do release atual, que
  ganha a dela na mudança seguinte. `tests/repo-changes.test.mjs` recusa a falta.
- **Achados com id estável e assinatura:** `R-NNN`, nunca reusado, e a assinatura
  `categoria · área · padrão`, que é o que agrupa recorrências entre retros.
- **O que não é pago vira adiamento:** o achado que fica para depois entra em
  [`DEFERRED.md`](../DEFERRED.md) com dono e gatilho, e a retro cita o `D-NNN`.
- **Num projeto com mudanças estruturadas,** a retro é registrada com `state.mjs run <change> retro.recorded --role invoker -- node <squad>/scripts/retro.mjs check <change> <arquivo>`; até lá o planner aponta `record_retro` e `state.mjs open` recusa com `E_RETRO_PENDING`. Neste repositório, que ainda não abre mudanças com `state.mjs` (D-009), quem cobra é `tests/repo-changes.test.mjs`.
- **Comece pelo medido:** `node scripts/retro.mjs collect <pr> --apply` lê o PR, os runs de CI de
  cada commit, os commits e o archive do merge e a seção **Atrito**, grava em `.spectree/retros/` e
  aponta as assinaturas conhecidas que casaram. Uma assinatura que casou é candidata; quem julga é a retro.
- **Modo legado:** enquanto as mudanças deste repo não forem abertas com `state.mjs` (D-009),
  esse é todo o rastro; a seção Atrito é a única fonte do que não chega ao GitHub.
- **Retro vazia é resultado:** diga em uma linha o que foi lido.

## Achados

| Id | Assinatura | Ocorrências | Situação |
|---|---|---|---|
| R-001 | `tool-economy · release · identificador-sequencial-disputado` | 13 | Aberto, [D-012](../DEFERRED.md) |
| R-002 | `automated-checks · docs · fechamento-depois-do-merge` | 12 | Pago na tarefa 11 |
| R-003 | `information-access · retro · rastro-apagado` | todos os PRs | Curto prazo pago na tarefa 11; longo prazo é o D-009 |
| R-004 | `automated-checks · protocol · teto-sem-folga` | 1 | Aberto, [D-013](../DEFERRED.md) |
| R-005 | `information-access · retro · leitura-so-graphql` | 1 | Pago na tarefa 11b |
| R-006 | `tool-economy · retro · contagem-manual` | 1 | Pago na tarefa 11b |

## Retros

- [2026-10-24 — `retro-pos-merge` (#79)](2026-10-24-retro-pos-merge.md)
- [2026-10-24 — lote do #58 ao #78](2026-10-24-lote-58-78.md)
- [2026-10-24 — `pass1-superficie` (#78)](2026-10-24-pass1-superficie.md)
