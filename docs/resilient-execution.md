# Execução resiliente — 1.12

Este ciclo trata orçamento esgotado sem revisão, divergência entre planejador e
executor, turno terminado sem entrega e resposta de bridge perdida após interrupção
do pai. Os testes usam repositórios temporários, sem acesso ao projeto de produção.

## Contrato

- Toda tentativa iniciada continua consumindo orçamento após reconciliação.
- A revisão altera somente o limite efetivo. Preserva plano original, escopo,
  referências, oráculos, tentativas e resultados anteriores.
- Trabalho pendente, processo gerenciado sem encerramento comprovado e plano
  obsoleto impedem a revisão. Não há retry automático.
- Cada decisão humana permite de uma a três tentativas adicionais, até dez no total
  por tarefa. Identidade declarada e evidências são auditadas, não autenticadas.
- A revisão não muda o lifecycle. Uma mudança `blocked` continua bloqueada até sua
  recuperação explícita. QA independente, CI e integração mantêm seus gates.

## Revisar um orçamento

Use primeiro `tasks.mjs recover` para as tentativas pendentes, após inspecionar seus
efeitos e processos. Prepare uma inspeção, por exemplo:

```json
{
  "cause": "Tentativa interrompida por quota; efeitos e recibos inspecionados.",
  "new_hypothesis": "Retomar o comportamento faltante após resolver a limitação.",
  "refs": [".spectree/inputs/inspection-evidence.json"],
  "new_max_attempts": 3
}
```

Execute na raiz do consumidor. Na instalação Codex, `<scripts>` significa
`.spectree/squad/scripts`; no checkout do Invoker significa `scripts`.
Salve os documentos em `.spectree/inputs/`, fora do candidato versionado:

```powershell
node <scripts>/tasks.mjs budget-plan task-priority T1 --inspection .spectree/inputs/inspection.json |
  Set-Content -Encoding utf8 .spectree/inputs/budget-plan.json
```

O comando imprime `{plan, plan_digest}` sem escrever. Inspecione o plano e registre
a decisão real com o digest retornado:

```json
{
  "decision": "approve",
  "plan_digest": "digest retornado pelo comando",
  "kind": "human_in_session",
  "identity": "identidade do operador",
  "reason": "justificativa explícita para a tentativa adicional",
  "refs": [".spectree/inputs/operator-decision.txt"]
}
```

```text
node <scripts>/tasks.mjs budget-apply task-priority .spectree/inputs/budget-plan.json --decision .spectree/inputs/decision.json --apply
node <scripts>/tasks.mjs status task-priority
node <scripts>/state.mjs plan task-priority --json
```

Candidato, branch, HEAD, autoridade, histórico de tarefas e referências são
vinculados ao plano; alterações invalidam sua aplicação. Os locks do executor e
da autoridade protegem a escrita. Limite e auditoria são persistidos juntos no
task store; `budget_revisions` registra plano, decisão, horário, digest e elo
anterior. Hashes detectam inconsistências, mas não são assinaturas contra um
administrador que reescreva todo o estado local. Não edite JSON para repor tentativas.
O packet de retry leva a causa, nova hipótese, operação anterior e referências
inspecionadas ao agente, junto do limite efetivo e digest da revisão aplicada.

## Preflight e resultados

```text
node <scripts>/tasks.mjs preflight runner.json
```

O preflight verifica launcher, entrypoint de bridges Node diretos e transporte de argumentos antes de `run/repair`,
sem chamar o modelo. Login, quota e ferramentas internas permanecem `unverified`:
encontrar o CLI não prova que seu shell interno funciona.

O packet solicita um resultado final estruturado:

```json
{"spectree_result":1,"status":"blocked","reason":"Ferramenta necessária indisponível."}
```

Estados: `completed`, `blocked`, `failed`, `interrupted`. Um evento Codex
`turn.completed` isolado vira `turn_completed`/`transport_completed`; os checks
podem verificar o candidato, mas o turno sozinho nunca conclui a tarefa. Declarações
estruturadas bloqueadas/falhas/interrompidas impedem aceitação. Claude respeita
seu envelope terminal e o resultado estruturado. Bridges antigos com
`status: completed` continuam sujeitos aos mesmos testes. Timeout/quota têm
precedência sobre exit code 1. Saída malformada nunca é sucesso.

A observação é persistida em `<process_ref>/agent-result.json` antes dos checks.
Eventos registram classificação do agente e da tentativa. Uma queda posterior
permite inspecionar o resultado sem autorizar conclusão ou replay automático.

TAP completo com falhas de asserção recebe `FAIL`. Crash, sintaxe, skip/todo,
saída incompleta ou teste ausente continuam `INFRA_ERROR`. Timeout de processo
recebe `INCONCLUSIVE`. Todos impedem conclusão.

## Bridge com entrega persistente

Configuração para consumidor Codex instalado:

```json
{
  "kind": "bridge",
  "context_adapter": "codex",
  "command": ["node", ".spectree/squad/scripts/bridge.mjs", "serve", "240"],
  "timeout_seconds": 300
}
```

`serve` lê o packet por stdin e persiste o pedido em
`.spectree/bridge-mailbox/<dispatch-id>/request.json`. Use deadline menor que o
timeout do runner. Um integrador separado lê o pedido, despacha o agente real e
publica seu resultado final observado. O mailbox não cria agentes.

```text
node <scripts>/bridge.mjs inspect <dispatch-id>
node <scripts>/bridge.mjs publish <dispatch-id> agent-final.json --apply
```

`agent-final.json` exige `request_id`, `packet_digest`, `source: "agent_final"`,
`agent_id`, `status` (`completed`, `failed`, `interrupted`), `summary` e `refs` para
evidências locais do resultado. `error` é opcional (`timeout`, `rate_limit`, etc.).
A publicação é exclusiva e atômica; outro processo pode publicar, mas não substituir
a primeira resposta. Identidade do pedido e hashes são verificados; a proveniência
real depende do integrador confiável e das evidências que ele registra.

Respostas após o deadline ficam `late` para inspeção e não convertem timeout em
sucesso. Outra sessão lê pedido e resposta sem reemitir a missão. Sem resposta,
observe o agente original; não presuma encerramento. A supervisão local cobre o
bridge, **não** agentes de outro harness. Inspecione seu estado real e efeitos
antes de reconciliar. Não há execução única garantida de efeitos externos,
autenticação de agente ou recuperação de uma resposta nunca persistida.

## Verificação

`task-executor.test.mjs` cobre revisão obsoleta, limites, decisão vinculada,
preservação do histórico, retry revisado, preflight e classificação.
`resilient-transport.test.mjs` cobre publicação por outro processo, duplicatas,
evidência alterada, resposta tardia e asserção versus infraestrutura. A suíte
existente mantém os testes de dependências, reparo, gates, supervisão e instalação.
Fixtures sintéticas não comprovam desempenho de um modelo real.
