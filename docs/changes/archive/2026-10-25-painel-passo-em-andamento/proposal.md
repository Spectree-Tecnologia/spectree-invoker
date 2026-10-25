# Passo em andamento no topo do card, com os três orbs girando

Tarefa 29, pedida pelo Gilson em 2026-10-25 ao comparar o v1.67.0 com o Helper Desk no app desktop.
Release: v1.68.0.

**Mudança deltaless.** Esta mudança não carrega delta em `specs/`. Ela muda só como o painel do
Claude Code encabeça o card de um subagente em execução; nenhum comportamento do runtime muda.

## Problema

Um card em execução dizia `Orquestrando · 31 passos`: quantos passos, não o que o subagente faz agora.
O Helper Desk encabeça o card com o passo em andamento e um indicador girando.

## Escopo

1. **O card em execução encabeça com o passo em andamento**: `Passo 31 · Running: pnpm typecheck`,
   cortado com reticências; antes do primeiro passo, `Invocando…`. A lista abaixo mostra os passos
   anteriores, sem repetir o do topo.
2. **O indicador é do Invoker**: Quas, Wex e Exort girando como um ponteiro de relógio, o orb do
   subagente maior que os outros dois. No terminal, `◐`.
3. **Teste no kit**, visto falhando no código do #100.
4. A retro de `painel-card-contido` (#100), devida por esta.

## Fora do escopo

- Os tokens de um subagente em execução continuam aparecendo só quando ele termina um turno.
- Um card concluído ou com falha mantém `Concluído · N passos` e `Falhou · N passos`.

## O que esta mudança deve e não paga

O kit desenha a árvore, não a pintura: o giro foi visto só no código. A conferência no app desktop
segue com o Founder (R-011).
