# Adotar o próprio fluxo de mudança

Tarefa 1 do [ciclo de modularização do repositório](../../../ROADMAP.md#ciclo--o-repositório-seguindo-a-própria-arquitetura),
sequência aprovada pelo Founder em 2026-10-17.

**Mudança deltaless.** Nenhum comportamento observável do runtime muda, então esta
mudança não carrega delta em `specs/`. O critério de saída é a suíte existente verde,
sem expectativa enfraquecida.

## Problema

O protocolo exige que toda mudança entre por `docs/changes/<slug>/` e seja arquivada ao
fechar, e que o que foi visto e deixado de fora vá para `docs/DEFERRED.md`. Este
repositório não fazia nenhuma das duas coisas: cinco pastas de mudanças já integradas
seguiam abertas e não havia ledger de adiamentos.

## Escopo

1. Arquivar em `docs/changes/archive/<data-do-merge>-<slug>/` as mudanças integradas:
   `confiabilidade-entrega` (PR #38), `presence-fundacao` (#41), `presence-sessao-codex`
   (#43), `presence-voz-invoker` e `presence-realtime` (#48). A data é a do merge na main.
2. Corrigir os links que apontavam para as pastas movidas.
3. Criar o ledger estruturado `.spectree/deferred.json` com os itens do mapa de
   arquitetura que ficam para depois, e gerar `docs/DEFERRED.md` a partir dele com
   `delivery.mjs ledger --apply`, o mesmo mecanismo que o squad entrega aos consumidores.
4. Registrar a sequência aprovada no `docs/ROADMAP.md`.

## Ausências declaradas

- `presence-dialogo-squad` continua aberta: a P4.1 integrou, mas P4.2 e P4.3 seguem pendentes.
- Nenhum código de runtime, CLI, teste ou protocolo muda.
- Este repositório não ganha `docs/specs/`. A regra "sem backfill" vale aqui também.

## Critério de saída

- `docs/changes/` só com mudanças abertas.
- `node scripts/delivery.mjs ledger` aceita o `DEFERRED.md` sem drift.
- Nenhum link relativo quebrado em `docs/`.
- `build.mjs --check`, `check-plugin.mjs` e a suíte completa verdes.
