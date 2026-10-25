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
- **Leia as tendências:** `node scripts/retro.mjs trends` agrupa os achados de todas as retros pela
  assinatura e lê a situação da tabela abaixo. Assinatura em duas retros, não paga e ainda não
  quieta é a segunda recorrência, que pede mudança própria pelo item `retro-melhorias` do [ROADMAP](../ROADMAP.md);
  achado aberto que nenhuma das três últimas retros citou é candidato a fechar.
- **Modo legado:** enquanto as mudanças deste repo não forem abertas com `state.mjs` (D-009),
  esse é todo o rastro; a seção Atrito é a única fonte do que não chega ao GitHub.
- **Retro vazia é resultado:** diga em uma linha o que foi lido.

## Achados

| Id | Assinatura | Ocorrências | Situação |
|---|---|---|---|
| R-001 | `tool-economy · release · identificador-sequencial-disputado` | 17 | Aberto, [D-012](../DEFERRED.md); gatilho disparou em 2026-10-24 e de novo no #94/#95 |
| R-002 | `automated-checks · docs · fechamento-depois-do-merge` | 12 | Pago na tarefa 11 |
| R-003 | `information-access · retro · rastro-apagado` | todos os PRs | Curto prazo pago na tarefa 11; longo prazo é o D-009 |
| R-004 | `automated-checks · protocol · teto-sem-folga` | 4 | Aberto, [D-013](../DEFERRED.md); o #94 subiu o teto do núcleo, a mudança própria segue devida |
| R-005 | `information-access · retro · leitura-so-graphql` | 1 | Pago na tarefa 11b |
| R-006 | `tool-economy · retro · contagem-manual` | 1 | Pago na tarefa 11b |
| R-007 | `squad · thread · pedido-de-merge-atrasado` | 1 | Fora do projeto, registrado |
| R-008 | `information-access · ambiente · node-abaixo-do-piso` | 7 | Aberto: a sessão da tarefa 11d voltou ao Node 22.22.0; o script de ambiente não vale para toda sessão nova |
| R-009 | `automated-checks · protocol · regra-fora-do-inventario` | 1 | Pago na tarefa 13 para a regra da suíte única e na tarefa 22 para o núcleo (`core_normative`); cards seguem no [D-017](../DEFERRED.md) |
| R-010 | `review-standards · pr · sem-revisao-independente` | 1 | Pago na tarefa 21: `REVIEW.md` e revisor em contexto limpo por head |
| R-011 | `information-access · mod · sem-superficie-real` | 6 | Aberto: o v1.67.0 foi conferido pelo Founder no app desktop depois do merge; o giro do v1.68.0 segue sem conferência; ver o app antes do merge de um mod segue devido |
| R-012 | `information-access · executor · fixture-sem-run-real` | 1 | Aberto: o trailer `system` do 2.1.302 foi testado em fixture; a confirmação é o próximo run real do consumidor no v1.69.0 |

## Retros

- [2026-10-25 — `result-com-trailer-system` (#102)](2026-10-25-result-com-trailer-system.md)
- [2026-10-25 — `painel-passo-em-andamento` (#101)](2026-10-25-painel-passo-em-andamento.md)
- [2026-10-25 — `retrato-vetorial` (#98)](2026-10-25-retrato-vetorial.md)
- [2026-10-25 — `painel-cores-e-sites` (#99)](2026-10-25-painel-cores-e-sites.md)
- [2026-10-25 — `painel-card-contido` (#100)](2026-10-25-painel-card-contido.md)
- [2026-10-25 — `retrato-invoker` (#97)](2026-10-25-retrato-invoker.md)
- [2026-10-25 — `painel-invoker` (#96)](2026-10-25-painel-invoker.md)
- [2026-10-25 — `skills-fora-do-menu` (#95)](2026-10-25-skills-fora-do-menu.md)
- [2026-10-25 — `regras-de-volta-ao-nucleo` (#94)](2026-10-25-regras-de-volta-ao-nucleo.md)
- [2026-10-25 — `retro-tendencias` (#93)](2026-10-25-retro-tendencias.md)
- [2026-10-25 — `revisao-independente` (#92)](2026-10-25-revisao-independente.md)
- [2026-10-25 — `baseline-rodada-ci` (#91)](2026-10-25-baseline-rodada-ci.md)
- [2026-10-24 — `emenda-caminhos` (#90)](2026-10-24-emenda-caminhos.md)
- [2026-10-24 — `tap-vitest-aninhado` (#89)](2026-10-24-tap-vitest-aninhado.md)
- [2026-10-24 — `mutacoes-em-lote` (#88)](2026-10-24-mutacoes-em-lote.md)
- [2026-10-24 — `congelamento-antes-do-pass2` (#87)](2026-10-24-congelamento-antes-do-pass2.md)
- [2026-10-24 — `evidencia-neutra` (#86)](2026-10-24-evidencia-neutra.md)
- [2026-10-24 — `seguranca-piso-consumidor` (#85)](2026-10-24-seguranca-piso-consumidor.md)
- [2026-10-24 — `checagens-por-relatorio` (#84)](2026-10-24-checagens-por-relatorio.md)
- [2026-10-24 — `seguranca-resposta` (#83)](2026-10-24-seguranca-resposta.md)
- [2026-10-24 — `retro-gatilho` (#82)](2026-10-24-retro-gatilho.md)
- [2026-10-24 — `seguranca-ci` (#81)](2026-10-24-seguranca-ci.md)
- [2026-10-24 — `retro-coleta` (#80)](2026-10-24-retro-coleta.md)
- [2026-10-24 — `retro-pos-merge` (#79)](2026-10-24-retro-pos-merge.md)
- [2026-10-24 — lote do #58 ao #78](2026-10-24-lote-58-78.md)
- [2026-10-24 — `pass1-superficie` (#78)](2026-10-24-pass1-superficie.md)
