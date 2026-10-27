# Painel do Invoker sóbrio

Tarefa 43, pedida pelo Gilson em 2026-10-27: o painel ainda estava colorido demais para o gosto dele.
Release: v1.82.0.

**Mudança deltaless.** Esta mudança não carrega delta em `specs/`. Ela muda só o painel do Claude Code;
nenhum comportamento do runtime muda.

## Escopo

1. **Todo card de subagente tem a moldura na cor do texto apagado** (`inactive` do tema), no lugar da cor
   do orbe. O orbe do avatar segue dizendo o papel.
2. **Sai a barra de progresso dos cards.** O spinner e o "Passo N" seguem dizendo o que roda; `✓`, `✗`
   e o título dizem como terminou.
3. **A faixa da seção Concluídos fica no verde de concluído** (`success` do tema).
4. **Teste no kit** de que nada disso volta, visto falhando no código do #114.
5. A retro de `painel-limpo` (#114), devida por esta.

## Fora do escopo

- A faixa Em execução segue em Quas, e a barra do plano segue com as cores dos orbes.

## O que esta mudança deve e não paga

Nada além do R-011: a mudança é vista no app desktop pelo Founder depois do merge.
