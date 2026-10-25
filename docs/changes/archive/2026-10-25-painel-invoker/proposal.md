# Painel do Invoker no Claude Code

Tarefa 24, autorizada pelo Gilson em 2026-10-25. Release: v1.63.0.

**Mudança deltaless.** Esta mudança não carrega delta em `specs/`. Ela acrescenta ao plugin um módulo
de hooks do Claude Code que só observa a sessão; nenhum comportamento do runtime muda.

## Problema

O Founder acompanha a orquestração do squad pela conversa e pela Console, que roda à parte. Dentro do
Claude Code não há uma vista do que o Invoker despachou: quantos subagentes, de qual papel, o que cada
um está rodando, quanto custou. O pedido nasceu de um mod de referência (Helper Desk), com o Invoker
de avatar e os especialistas como os orbs do herói.

## Escopo

1. **`hooks/hooks.json` e `hooks/invoker-desk/`**: um painel lateral com o Invoker no centro e seis
   orbs, dois Quas (Solutions Architect, Integration Engineer), dois Wex (Full Stack Developer,
   Quality Engineer) e dois Exort (Platform Engineer, TypeSafe Engineer), que giram enquanto algum
   subagente roda. Mostra o custo da conversa, os tokens dos subagentes, o tempo de sessão, as seções
   "Em execução" e "Concluídos" recolhíveis, e um card por subagente com papel, tokens, duração,
   status, os últimos passos e a lista completa. `/invoker-desk` reabre o painel; a status line diz
   quantos orbs estão ativos.
2. **`plugin.json` aponta o contrato de estado** (`types`), que o `claude plugin validate` confere.
3. **`tests/invoker-desk.test.mjs`**: o módulo que o manifesto nomeia existe, o estado fica sob o nome
   do plugin, há um orb por card de `agents/`, dois de cada tipo, nada alcança rede ou processo, e o
   comando não colide com `/invoker`. **`tests/invoker-desk.test.tsx`** roda com `claude plugin test`.
4. Uma seção no `docs/install.md`.
5. A retro de `skills-fora-do-menu` (#95), devida por esta.

## Decisões

- **Dentro do plugin principal**, por escolha do Founder no cartão da thread, em vez de um plugin
  separado no marketplace. Consequência aceita: o plugin passa a depender dos function hooks, uma API
  em early access que muda entre releases. O Codex não lê `hooks/hooks.json` e não muda.
- **O painel só observa.** Uma falha da contabilidade é registrada no log e nunca recusa um despacho,
  uma chamada de ferramenta ou um turno; nada sai da sessão.
- **Abre sozinho uma vez por sessão**, só no desktop e no VS Code, onde o painel é uma barra lateral, e
  só numa pasta com `.spectree/` ou `docs/changes/`, ou no primeiro despacho de um especialista.
- **O desenho do Invoker é original em SVG**, sem arte do jogo.

## Fora do escopo

- Registro de run para despachos feitos pelo Agent tool direto do loop principal: o painel mostra,
  mas a trilha em `.spectree/runs/` continua só do `tasks.mjs`.
- Ícone do plugin e qualquer mudança na Console ou na Presence.

## O que esta mudança deve e não paga

O CI não tem Claude Code, então `claude plugin test` não roda lá: a suíte do painel em
`tests/invoker-desk.test.tsx` é prova local, e o CI guarda só a estrutura. Fica dito aqui, sem item
novo no ledger.
