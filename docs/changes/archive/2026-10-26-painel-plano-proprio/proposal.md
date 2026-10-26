# Plano próprio do Invoker no painel

Tarefa 38, pedida pelo Gilson em 2026-10-26 ao ver o painel dizer `Nenhum plano em andamento.` com um
plano rodando na barra do Helper Desk. Ele escolheu o plano próprio no cartão de decisão.
Release: v1.77.0.

**Mudança deltaless.** Esta mudança não carrega delta em `specs/`. Ela muda só o painel do Claude Code
e a instrução de plano que ele põe no prompt da sessão; nenhum comportamento do runtime muda.

## Problema

O app desktop não tem TodoWrite. O Helper Desk registra a ferramenta `mcp__helper-desk__plan` e põe no
prompt a instrução de usá-la; é dela que veio o plano `role-integrity — início`. A barra do Invoker
escutava só TodoWrite, TaskCreate e TaskUpdate, então nunca via o plano. E o Helper Desk responde à
própria ferramenta sem passar adiante, então a chamada nem sempre chega ao painel.

## Escopo

1. **O Invoker registra a sua ferramenta de plano**, `mcp__spectree__plan`: um título curto e os
   passos em ordem, cada um `pending`, `in_progress` ou `completed`, a lista inteira a cada chamada.
   O painel responde a ela no próprio processo; a chamada de um subagente é recusada.
2. **A instrução vai no prompt do laço principal** (não no de um teammate nem no modo `bare`): planejar
   com a ferramenta antes de agir quando houver dois passos ou mais, e atualizar a cada passo.
3. **A barra mostra o título do plano** no lugar de `Plano`, cortado em 40 caracteres.
4. **O plano do Helper Desk também entra** quando a chamada dele chega ao painel.
5. **A guarda de rede do painel aceita `$.tool.register`**: registrar a ferramenta não executa nada;
   `$.tool.call` continua recusado, com auto-teste dos dois lados.
6. **Teste no kit**, visto falhando no código do #109.
7. A retro de `orcamento-de-contexto` (#109), devida por esta.

## Fora do escopo

- Os lembretes do Helper Desk ao modelo quando ele trabalha sem plano não foram copiados.
- Com o Helper Desk instalado, o modelo vê duas ferramentas de plano. O Founder desliga o Helper Desk.

## O que esta mudança deve e não paga

Não se sabe se o modelo usa a ferramenta sem os lembretes; a prova é a próxima sessão do Founder no app
desktop com o Helper Desk desligado (R-011).
