# Painel do Invoker mais limpo

Tarefa 42, pedida pelo Gilson em 2026-10-27: o painel estava colorido demais para o gosto dele.
Release: v1.81.0.

**Mudança deltaless.** Esta mudança não carrega delta em `specs/`. Ela muda só o painel do Claude Code;
nenhum comportamento do runtime muda.

## Escopo

1. **Sai a linha verde `N subagentes nesta conversa`.** As seções Em execução e Concluídos já dizem
   quantos há em cada uma; o botão Ocultar fica à direita.
2. **O plano perde a moldura magenta, e o título dele fica na cor do texto.** A barra segue com as cores
   dos orbes.
3. **Teste no kit** de que nada disso volta, visto falhando no código do #113.
4. A retro de `navegador-detectado` (#113), devida por esta.

## Fora do escopo

- As cores dos cards e das seções ficam como estão.

## O que esta mudança deve e não paga

Nada além do R-011: a mudança é vista no app desktop pelo Founder depois do merge.
