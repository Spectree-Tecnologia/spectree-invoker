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
- **Modo legado:** enquanto as mudanças deste repo não forem abertas com `state.mjs` (D-009),
  o rastro vem do GitHub (PRs, runs do CI, commits do merge) e da seção **Atrito** do PR.
- **Retro vazia é resultado:** diga em uma linha o que foi lido.

## Achados

| Id | Assinatura | Ocorrências | Situação |
|---|---|---|---|
| R-001 | `tool-economy · release · identificador-sequencial-disputado` | 13 | Aberto, [D-012](../DEFERRED.md) |
| R-002 | `automated-checks · docs · fechamento-depois-do-merge` | 12 | Pago na tarefa 11 |
| R-003 | `information-access · retro · rastro-apagado` | todos os PRs | Curto prazo pago na tarefa 11; longo prazo é o D-009 |
| R-004 | `automated-checks · protocol · teto-sem-folga` | 1 | Aberto, [D-013](../DEFERRED.md) |

## Retros

- [2026-10-24 — lote do #58 ao #78](2026-10-24-lote-58-78.md)
- [2026-10-24 — `pass1-superficie` (#78)](2026-10-24-pass1-superficie.md)
