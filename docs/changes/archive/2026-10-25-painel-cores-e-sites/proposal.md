# Cores dos orbs nos cards e sites nos passos do painel

Tarefa 27, pedida pelo Gilson em 2026-10-25 ao ver o v1.65.0 no app desktop ao lado do Helper Desk.
Release: v1.66.0.

**Mudança deltaless.** Esta mudança não carrega delta em `specs/`. Ela muda só como o painel do
Claude Code desenha os cards e os passos; nenhum comportamento do runtime muda.

## Problema

Comparado ao Helper Desk, o painel deixava três coisas menos legíveis:

1. O card de um subagente tinha borda apagada, sem dizer de que orb ele é.
2. As seções Em execução e Concluídos eram só um texto colorido, sem marcar onde começam.
3. Um passo de WebFetch dizia `Using WebFetch`, sem o site aberto.

## Escopo

1. **A borda do card na cor do seu orb**: Quas azul, Wex magenta, Exort laranja; um papel sem orb fica
   cinza.
2. **Cada seção abre numa faixa colorida**: Em execução na cor de Quas, Concluídos na de Exort.
3. **O passo diz o que a web fez**: `Opening <site>` para um WebFetch, com só o host do endereço, e
   `Searching: <busca>` para um WebSearch.
4. **Teste no kit**, visto falhando no código do #98: a borda, a faixa e os dois passos.
5. A retro de `retrato-vetorial` (#98), devida por esta.

## Fora do escopo

- Os tokens de um subagente em execução continuam aparecendo só quando ele termina um turno.

## O que esta mudança deve e não paga

O resultado foi visto só no kit de testes; a conferência no app desktop segue com o Founder (R-011).
