# README e About que descrevem a tecnologia

Tarefa 53, pedida pelo Gilson em 2026-10-30 ("o README do spectree-invoker e o about do nosso
repositorio, não representa a nossa tecnologia"), com o idioma inglês escolhido no cartão de decisão
e o OK da mudança na thread. Release: v1.92.0.

**Mudança deltaless.** Não há delta em `specs/`. Ela troca a apresentação do plugin; nenhum script,
regra do protocolo ou `Scenario` de projeto consumidor muda.

## Problema

A pesquisa sobre o repositório e sobre Spec Kit, OpenSpec, BMAD, Superpowers, GSD e Kiro achou quatro
defeitos na apresentação:

- a tese certa ("só aceita como pronto o que um comando provou") ficava abstrata, e o mecanismo que
  nenhum concorrente lido declara (evidência presa ao digest do conteúdo, máquina de estados que
  recusa, QA isolado, recibo pós-merge) aparecia só no meio do texto;
- partes velhas: "Como o plugin evolui" parado na 1.16.0 e na P4.1, contagens de testes de 136, 188 e
  258 em `docs/compatibility.md`, e o não-objetivo "no MCP server, no dashboard", que o Console e a
  ferramenta `mcp__spectree__plan` do painel desmentem;
- faltas: para quem é e para quem não é, o painel do Invoker, o mascote, o TypeSafe como opcional e
  pago, e qualquer imagem;
- três descrições diferentes do produto: About, `plugin.json` e `package.json`.

## Escopo

1. `README.md` reescrito em inglês: tese e público na primeira tela, início rápido com os mesmos
   comandos, o mecanismo da prova, os três gates separados das duas aprovações que o runtime grava,
   o squad, para quem não é, comprovado contra pendente, e a parte de contribuição curta.
2. `docs/assets/spectree-mascot.svg`, extraído sem mudança de `MASCOT_ART.mascot` em
   `hooks/invoker-desk/mascot-art.ts`, com `xmlns` e tamanho; visto renderizado em fundo claro e
   escuro antes do commit.
3. A mesma descrição em inglês em `package.json`, `.claude-plugin/plugin.json` e no plugin de
   `.claude-plugin/marketplace.json`; quatro keywords novas no `plugin.json`.
4. `docs/compatibility.md`: as contagens velhas saem, a contagem medida na v1.91.0 entra, e o
   não-objetivo diz o que o Console e o painel são.
5. A retro de `auditoria-correcoes` (#124).

## Fora do escopo

- O About e os topics do GitHub: o Gilson os troca nas configurações do repositório. A proposta está
  no PR.
- Os guias em `docs/` continuam em português; o README diz isso na seção Documentation.
- O GIF do runtime recusando um "pronto" sem prova, que a pesquisa apontou como a melhor imagem
  possível.

## O que esta mudança deve e não paga

- A contagem de testes em `docs/compatibility.md` volta a envelhecer a cada mudança; nada a mede no CI.
- O README não cita números de testes para não envelhecer do mesmo jeito.
- O nome "Invoker" e os nomes Quas, Wex e Exort lembram um jogo; ninguém conferiu marca registrada.
