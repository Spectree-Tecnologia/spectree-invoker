# Cota lida só do que é estruturado no executor

Tarefa 48, autorizada pelo Gilson em 2026-10-29 a partir da retro do SYND: o executor marcou como cota
três tentativas de T-HTTP que tinham terminado com sucesso, porque o texto antes do JSON final citava
o rate limit. Triagem em `/mnt/project-files/analysis/retro-synd-executor-cota.md`. Primeira de três
mudanças em série. Release: v1.87.0.

**Mudança deltaless.** Esta mudança não carrega delta em `specs/`. Ela corrige o leitor de resultado
do executor de tarefas do runtime do squad; o comportamento dos projetos consumidores não muda.

## Problema

O leitor de resultado de `tasks.mjs run/repair` (Codex e Claude Code) confundia três coisas com cota:

1. **Prosa antes da declaração.** A declaração `spectree_result` só era reconhecida quando a mensagem
   final inteira era JSON. Com qualquer frase antes, ou com o JSON num bloco de código, a declaração
   se perdia e o texto livre passava pela busca de cota. Uma tarefa sobre rate limit saía `interrupted`
   com classificação `quota`.
2. **Saída de ferramenta no Codex.** Todo comando com saída diferente de zero entrava no texto de
   falha. Um teste vermelho chamado "rate limit" no meio do turno marcava como cota uma declaração
   `completed`.
3. **Razão de uma declaração de falha.** Um `failed` cuja razão citava o rate limit da tarefa também
   virava cota.

## Escopo

1. **A declaração é o objeto que fecha a mensagem final.** Prosa antes dela e um bloco de código de três crases em
   volta são aceitos; um objeto citado no meio do texto não é declaração. O início do objeto é achado
   numa só passada de trás para frente, casando as chaves fora das strings JSON, em tempo linear.
2. **Cota só vem do que é estruturado:** os eventos de falha do próprio harness (`turn.failed` e
   `error` no Codex; `error` e os erros do `result` no Claude Code), a razão de uma declaração
   `interrupted`, e a prosa só quando não houve declaração nenhuma. Nunca a saída de uma ferramenta,
   uma recusa de permissão ou a razão de uma declaração `completed`, `failed` ou `blocked`.
3. **Teste discriminante** em `tests/task-executor-agents.test.mjs`: vermelho no código do #118 (`fa64575`) com
   `interrupted` no lugar de `reported_success`.
4. A retro de `inventario-sem-processos` (#120), devida por esta.

## Fora do escopo

- A guarda de `state.mjs open` sem `--modules` e a da rodada do pass 2 sem registro: mudança 49.
- A regra multi-caminho no card do Architect: mudança 50.
- A bridge segue lendo o envelope com `outcome()`, que já classifica pelos campos estruturados.

## O que esta mudança deve e não paga

- Prosa sem declaração que cite uma cota continua classificada como cota. Isso é conservador de
  propósito: sem declaração, a tentativa nunca seria sucesso, e a recusa custa uma tentativa, não uma
  entrega falsa.
- No Codex, um item com erro (`item.error`, ou um item do tipo `error`) é tratado como trabalho do
  agente e não conta como cota. Só `error` e `turn.failed` no nível do turno contam.
