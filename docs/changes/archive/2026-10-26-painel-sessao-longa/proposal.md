# Painel do Invoker em sessão longa

Tarefa 39, pedida pelo Gilson em 2026-10-26 ao ver o painel trocar o desenho por
`spectree has not drawn in this pane` no meio de uma sessão com mais de 20 subagentes concluídos.
Release: v1.78.0.

**Mudança deltaless.** Esta mudança não carrega delta em `specs/`. Ela muda só o painel do Claude Code;
nenhum comportamento do runtime muda.

## Problema

O painel redesenha a árvore inteira a cada segundo, por causa do relógio. Cada card concluído levava a
pintura grande do orbe, uns 50 mil caracteres de SVG num quadro interativo. Com 22 cards, cada redesenho
somava mais de 1,2 milhão de caracteres e 22 quadros com filtros, e a lista crescia sem limite. A causa é
inferida pela medida e pelo sintoma, que cresce com a sessão; o log do app não foi lido.

## Escopo

1. **Card concluído leva a pintura pequena do orbe** (uns 8 mil caracteres); a grande fica com o card em
   execução e com o retrato do Invoker.
2. **A seção Concluídos mostra os últimos 5**, com um botão para ver todos e voltar.
3. **O estado guarda no máximo 50 concluídos**; o mais antigo despachado sai primeiro.
4. **Teste no kit** com 60 subagentes concluídos e um em execução, visto falhando no código do #110.
5. A retro de `painel-plano-proprio` (#110), devida por esta.

## Fora do escopo

- O relógio de um segundo continua; é ele que anda o tempo dos cards em execução.

## O que esta mudança deve e não paga

A causa não foi confirmada no log do app desktop; a prova é a próxima sessão longa do Founder (R-011).
