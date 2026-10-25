# Barra do plano em andamento no lugar dos números do painel

Tarefa 31, pedida pelo Gilson em 2026-10-25 ao ver a barra de progresso do plano no Claude Code.
Release: v1.70.0.

**Mudança deltaless.** Esta mudança não carrega delta em `specs/`. Ela muda só o que o painel do
Claude Code mostra abaixo do retrato; nenhum comportamento do runtime muda.

## Problema

O painel mostrava custo da conversa, tokens dos subagentes e tempo. O Founder quer ver ali o plano
que o Invoker está executando: quantas tarefas fecharam e qual está em andamento.

## Escopo

1. **A barra do plano substitui os três números.** Ela acompanha a lista de tarefas do laço
   principal (TaskCreate, TaskUpdate e TodoWrite); a lista de um subagente não entra.
2. **A barra é do Invoker**: um trilho cortado em um trecho por tarefa, preenchido de Quas a Exort
   passando por Wex, com um brilho correndo enquanto falta tarefa. Ao lado, `Tarefas 3/7 · 43%`.
3. **A linha de baixo diz o que acontece**: `Agora: <tarefa em andamento>`, senão
   `A seguir: <próxima>`, senão `Plano concluído`. Sem tarefas, `Nenhum plano em andamento.`
4. **Os números saem do painel**: custo, tokens somados e tempo da sessão deixam de ser lidos e
   guardados. O tempo e os tokens de cada card ficam.
5. **Teste no kit**, visto falhando no código do #102. Os dois testes dos números foram trocados
   pelos da barra, porque o que eles provavam saiu do painel.
6. A retro de `result-com-trailer-system` (#102), devida por esta.

## Fora do escopo

- O plano não tem nome próprio: o rótulo é `Plano`.
- Os tokens de um subagente em execução continuam aparecendo só quando ele termina um turno.

## O que esta mudança deve e não paga

O kit desenha a árvore, não a pintura: o brilho da barra foi visto só no código. A conferência no app
desktop segue com o Founder (R-011).
