# Barra do plano no terminal, no estilo do Helper Desk

Tarefa 44, pedida pelo Gilson em 2026-10-28: a barra do plano não aparecia no CLI, e a do Helper Desk era
mais moderna.
Release: v1.83.0.

**Mudança deltaless.** Esta mudança não carrega delta em `specs/`. Ela muda só o painel do Claude Code;
nenhum comportamento do runtime muda.

## Escopo

1. **No terminal, o plano aparece acima do prompt**, abaixo da faixa de qualquer outro plugin. A linha tem:
   - o ponto e o título;
   - uma fileira de blocos no degradê Quas, Wex e Exort, com a tarefa em andamento piscando em `▓` e o
     resto do trilho em `░`;
   - `Tarefas n/m` e a porcentagem.

   Embaixo vem a linha "Agora", e nada mais é desenhado. No desktop e no editor o plano segue no painel.
2. **Um plano concluído fica acima do prompt só até a próxima mensagem da pessoa.** Um plano ou tarefa
   nova o traz de volta.
3. **A barra do painel ganha os detalhes do Helper Desk**, mantendo as cores dos orbes:
   - faíscas que piscam sobre o preenchimento;
   - o brilho que varre;
   - a tarefa em andamento acesa até a próxima marca;
   - as marcas só no trecho que falta.

   Um plano concluído é imagem parada.
4. O fallback em texto do painel usa os mesmos blocos da faixa.
5. **Teste no kit** da faixa e da barra nova.
6. A retro de `painel-sobrio` (#115), devida por esta.

## Fora do escopo

- O botão ✕ do Helper Desk para esconder a faixa. O plano concluído sai sozinho na mensagem seguinte.
- A pílula com a contagem dentro da barra: a barra do painel estica para a largura da coluna, e um texto
  dentro do desenho esticaria junto. A contagem segue ao lado.
- Nenhum relógio novo. A faixa pisca no tique que já existe enquanto um subagente roda e fica parada no resto
  do tempo.

## O que esta mudança deve e não paga

Nada além do R-011: a mudança é vista no terminal pelo Founder depois do merge.
