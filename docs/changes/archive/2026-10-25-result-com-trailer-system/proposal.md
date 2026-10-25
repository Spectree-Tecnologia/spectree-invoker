# Execução do Claude Code com trailer `system` depois do `result`

Tarefa 30, bug relatado pelo Invoker no projeto SYND (mudança `passkeys`, plugin 1.67.0) e autorizado
pelo Gilson em 2026-10-25. Release: v1.69.0.

**Mudança deltaless.** Esta mudança não carrega delta em `specs/`. Ela corrige como o executor lê a
saída `stream-json` do Claude Code e o texto do perfil `implement`; nenhum `Scenario` muda.

## Problema

O Claude Code 2.1.302 emite `{"type":"system","subtype":"task_summary",…}` depois do evento `result`.
`claudeEvents` só aceitava `reported_success` quando o `result` era o último evento, então toda
execução bem-sucedida virava `unknown`: a tarefa ia para `reconcile`, `implemented` recusava com
`E_TASK_INCOMPLETE` e cada tentativa gastava orçamento.

O agente também terminou em prosa, sem a linha `spectree_result`. Isso não causa o `unknown` (sem a
linha, `mission` fica `null` e o status continua `reported_success`), mas o perfil pedia a linha só
"quando o pacote incluir um result_contract", e o pacote sempre inclui.

## Escopo

1. **Depois do único `result`, só eventos `system` são aceitos.** Qualquer outro tipo, um segundo
   `result` ou uma linha malformada continuam `unknown`.
2. **Teste com o trailer `task_summary`** e os casos negativos, visto falhando no código do v1.68.0.
3. **O perfil `implement` pede a linha sem condição**: a última linha da mensagem final é só o JSON
   do `result_contract`, sem prosa depois. Gerado para os dois adapters por `npm run build`.
4. A retro de `painel-passo-em-andamento` (#101), devida por esta.

## Fora do escopo

- O leitor do Codex (`codexEvents`) não muda: nenhum trailer novo foi observado ali.
- A tentativa que o SYND já gastou não é devolvida por esta mudança; o orçamento segue o caminho de
  `tasks.mjs budget-plan` se faltar.

## O que esta mudança deve e não paga

O trailer foi reproduzido em fixture a partir do relato, não de um run real do 2.1.302 nesta sessão.
A confirmação fica com o próximo `tasks.mjs run` do SYND no v1.69.0.
