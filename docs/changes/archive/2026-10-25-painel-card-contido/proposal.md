# Passos longos cortados dentro do card do painel

Tarefa 28, pedida pelo Gilson em 2026-10-25 ao ver o v1.66.0 no app desktop.
Release: v1.67.0.

**Mudança deltaless.** Esta mudança não carrega delta em `specs/`. Ela muda só como o painel do
Claude Code dispõe o card de um subagente; nenhum comportamento do runtime muda.

## Problema

A borda do card marca a área dele. Um passo com um caminho longo passava da borda, e a coluna de texto
crescia até empurrar o avatar do subagente para fora do card; o avatar voltava quando os passos
ficavam curtos de novo.

## Escopo

1. **O card corta o que não cabe**: o card esconde o que passa da borda, a coluna de texto pode
   encolher abaixo da largura do seu texto mais longo, e o avatar nunca encolhe.
2. **O passo é um texto só**, cortado com reticências no fim.
3. **Teste no kit**, visto falhando no código do #99.
4. A retro de `painel-cores-e-sites` (#99), devida por esta.

## Fora do escopo

- O passo continua cortado no fim; o começo do caminho fica visível, o nome do arquivo pode sumir.

## O que esta mudança deve e não paga

O kit de testes desenha a árvore, não a pintura: ele prova as propriedades do card, não a largura
desenhada. A conferência no app desktop segue com o Founder (R-011).
