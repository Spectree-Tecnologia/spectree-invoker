# Painel do Invoker no rebrand da Spectree: o mascote no centro

Tarefa 45, pedida pelo Gilson em 2026-10-28: a Spectree tem mascote e paleta novos, e o mascote toma o
lugar do Invoker no painel.
Release: v1.84.0.

**Mudança deltaless.** Esta mudança não carrega delta em `specs/`. Ela muda só o painel do Claude Code;
nenhum comportamento do runtime muda.

## Escopo

1. **O mascote no centro do painel, no lugar do retrato do Invoker.** Saem os seis orbs e o giro, e os
   orbs saem também dos cards. A arte do Founder vai traçada em polígonos, porque o app desktop
   remove `<image>` de um Svg. Por cima vai uma aura e um brilho em Spirit, com uma flutuação leve.
2. **O especialista que trabalha toma o lugar do mascote.**
   - O Solutions Architect e o Full Stack Developer têm cena própria.
   - Os outros quatro usam, por enquanto, uma expressão da folha do mascote.
   - Com vários rodando, aparece o último despachado.
   - Parado, com um plano concluído, o mascote sorri.
3. **A paleta nova:** Void, Surface, Mist, Spirit e Depth.
   - A barra do plano e a faixa do terminal vão de Depth a Spirit.
   - O spinner usa pontos Spirit.
   - A seção Em execução fica em Depth.
   - A seção Concluídos segue no verde de concluído, que é o pedido da tarefa 43.
4. **O avatar do card é o mascote pequeno.**
   - Enquanto o subagente roda, o card mostra a expressão do papel na folha do mascote: o Architect
     curioso, o Developer sorrindo, o Platform sério, o Integration e o TypeSafe piscando, e o Quality
     bravo. É o pedido de 2026-10-29.
   - Terminado, o card mostra o rosto da folha sorrindo quando concluiu, e bravo quando falhou ou foi
     interrompido. Os dois ficam parados.
5. **No terminal**, o mascote é desenhado só como os dois olhos.
6. **A guarda do CI troca os orbs pelos papéis e pela arte do mascote.** Cada card tem a sua arte, cada
   arte é um traçado só de caminhos, e cada uma cabe no limite do Svg.
7. A retro de `barra-plano-terminal` (#116), devida por esta.

## Fora do escopo

- O fundo do painel continua o do tema. Pintar o fundo de Void deixaria o texto escuro do tema claro
  ilegível.
- A arte própria do Platform, Integration, Quality e TypeSafe Engineer: entra quando o Founder mandar.

## O que esta mudança deve e não paga

Nada além do R-011: a mudança é vista no app desktop pelo Founder depois do merge.
