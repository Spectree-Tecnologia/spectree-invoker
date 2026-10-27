# Desempenho do painel do Invoker

Tarefa 40, pedida pelo Gilson em 2026-10-27 depois do levantamento de performance do painel
(`analysis/performance-painel-invoker.md` nos arquivos do projeto), que ele autorizou implementar.
Release: v1.79.0.

**Mudança deltaless.** Esta mudança não carrega delta em `specs/`. Ela muda só o painel do Claude Code;
nenhum comportamento do runtime muda.

## Problema

Depois do #111, quatro custos do painel ainda cresciam com a sessão ou com o paralelismo. Cada passo de
subagente regravava o estado de todos os subagentes, uns 685 mil caracteres numa sessão longa. O relógio
redesenhava o painel inteiro a cada segundo, mesmo sem nada rodando. O card em execução levava a pintura
grande do orbe. E todo desenho saía como quadro interativo, mesmo parado. Um erro de desenho deixava o
painel em branco.

## Escopo

1. **Os passos de cada subagente ficam num valor próprio**, um por subagente: um passo escreve só o
   dele. A linha do card fica curta, e cada subagente guarda os últimos 30 passos.
2. **O relógio só anda enquanto há subagente em execução.**
3. **Todo card usa a pintura pequena do orbe**; a grande fica só no retrato do Invoker.
4. **Quadro interativo só no que se mexe:** o retrato, o spinner, e o avatar e a barra de um card em
   execução; a barra do plano enquanto falta tarefa.
5. **Um desenho que falha mostra o painel em recuperação**, nunca em branco, e o erro vai para o log.
6. **Teste de orçamento no kit**, com 60 subagentes de 40 passos e 8 em execução, e guarda no CI contra
   quadro em desenho parado e pintura grande no card. Vistos falhando no código do #111.
7. A retro de `painel-sessao-longa` (#111), devida por esta.

## Fora do escopo

- A pintura grande dos orbes continua em `orb-art.ts`, sem uso no desenho; tirá-la muda a guarda das
  pinturas e fica para uma mudança própria.
- O retrato do Invoker continua redesenhado a cada tique enquanto algo roda.
- Na primeira carga depois da atualização, o painel recomeça a lista da sessão, porque a forma do estado mudou.

## O que esta mudança deve e não paga

O ganho foi medido no kit; o app desktop não foi visto (R-011). A prova é a próxima sessão longa do Founder.
