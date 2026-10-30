# README sem a seção do que está comprovado

Tarefa 54, pedida pelo Gilson em 2026-10-30, logo depois do merge do #125 ("retira isso do readme: O
que está comprovado — e o que não está"). Release: v1.93.0.

**Mudança deltaless.** Não há delta em `specs/`. Ela tira uma seção do README; nenhum script, regra
do protocolo ou `Scenario` de projeto consumidor muda.

## Escopo

1. `README.md` perde a seção "What is proven — and what is not" inteira.
2. A retro de `readme-posicionamento` (#125).

## Fora do escopo

- `docs/compatibility.md` e `docs/maintenance.md` continuam com o registro completo do que foi
  observado e do que está pendente; o README ainda aponta para os dois na seção Documentation.
- O Nit da revisão do #125 sobre a voz gravada do Presence também ser paga.

## O que esta mudança deve e não paga

- O README deixa de dizer, na primeira leitura, o que segue pendente: isolamento no Codex, pipeline
  completo com agentes reais, tempo de entrega, macOS e o painel em early access. Isso agora só se
  lê em `docs/compatibility.md` e `docs/maintenance.md`.
