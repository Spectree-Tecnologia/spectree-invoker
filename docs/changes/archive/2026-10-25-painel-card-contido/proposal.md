# Card do painel contido na borda e com o modelo do subagente

Tarefa 28, pedida pelo Gilson em 2026-10-25 ao ver o v1.66.0 no app desktop ao lado do Helper Desk.
Release: v1.67.0.

**Mudança deltaless.** Esta mudança não carrega delta em `specs/`. Ela muda só como o painel do
Claude Code dispõe o card de um subagente; nenhum comportamento do runtime muda.

## Problema

A borda do card marca a área dele. Um passo com um caminho longo passava da borda, e a coluna de texto
crescia até empurrar o avatar do subagente para fora do card; o avatar voltava quando os passos
ficavam curtos de novo.

O card também dizia só o papel (`Solutions Architect`). O Helper Desk diz o tipo do subagente, o
modelo em que ele roda e o esforço.

## Escopo

1. **O card corta o que não cabe**: o card esconde o que passa da borda, a coluna de texto pode
   encolher abaixo da largura do seu texto mais longo, e o avatar nunca encolhe.
2. **O passo é um texto só**, cortado com reticências no fim; na linha do título e na do tipo, o texto da
   esquerda encolhe e o da direita (status, tokens e tempo) não.
3. **O card identifica o subagente**: `spectree:solutions-architect · Opus 5.5 · medium`. O modelo vem
   do início do subagente; o esforço, do último pedido que ele fez ao modelo, e falta enquanto não houver um.
4. **Teste no kit**, visto falhando no código do #99.
5. A retro de `painel-cores-e-sites` (#99), devida por esta.

## Fora do escopo

- O passo continua cortado no fim; o começo do caminho fica visível, o nome do arquivo pode sumir.

## O que esta mudança deve e não paga

O kit de testes desenha a árvore, não a pintura: ele prova as propriedades do card, não a largura
desenhada. A conferência no app desktop segue com o Founder (R-011).
