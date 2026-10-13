# Confiabilidade de Entrega — 1.13

O ciclo vincula a entrega a uma execução completa, ao inventário de testes e às
obrigações do projeto. Complementa a Execução Resiliente sem substituir aprovação,
QA independente, CI remoto ou confirmação de integração.

## Adoção explícita

Para um projeto novo, use `state.mjs init <projeto> --delivery` com os demais argumentos
do bootstrap. Para um consumidor existente autorizado, preserve sua configuração e
acrescente `"delivery": { "version": 1 }` a `.spectree/project.json`. Atualizar o pacote
não habilita o perfil automaticamente. Não execute `init` sobre um projeto existente
para habilitar a política: ele também grava outras configurações.

Migre as pendências existentes para `.spectree/deferred.json` mantendo IDs, decisões
e responsáveis. Inspecione a projeção antes de substituir um documento manual:

```text
node <scripts>/delivery.mjs ledger
node <scripts>/delivery.mjs ledger --apply
```

O segundo comando gera `docs/DEFERRED.md`. Uma divergência bloqueia os gates quando
o perfil está habilitado. Gere e estabilize o documento antes da suíte e do fechamento.
Pendências abertas podem declarar `due: { "change_id": "identidade", "state": "implemented" }`.
O bloqueio ocorre nesse marco e nos seguintes dessa mudança. Use o ID real da mudança,
não um apelido do roadmap. Itens futuros não bloqueiam C1; gatilhos textuais continuam
visíveis, mas não são interpretados como prazos automáticos. Uma resolução precisa de
uma referência a evidência observada PASS da mudança que a encerrou.

## Contrato da suíte

Veja `examples/delivery-verification.json`. O plano versionado em
`docs/changes/<id>/verification.json` precisa de `change`, `delivery.version: 1` e
`delivery.suites`. Cada suíte declara argv, timeout, formato TAP, `full_suite: true`,
inventário completo de nomes únicos de testes-folha, mapeamento de cenários e um probe
do reporter. Inclua também os testes unitários adicionais no inventário.

Os cenários dos checks comportamentais precisam de mapeamento. Cenários ADDED/MODIFIED
do delta também são conferidos diretamente: a referência é
`módulo / título do Requirement / título do Scenario`. Um resultado de grupo/describe
não substitui seus testes. Testes adicionais não declarados exigem atualização do
inventário; remover um teste não pode tornar a execução silenciosamente verde.

O comando de probe usa o mesmo runner/reporter da suíte e emite um teste com o nome
declarado. Com `SPECTREE_DELIVERY_PROBE=pass` ele passa; com `fail` produz uma falha de
asserção real. Crash, skip e impressão de uma palavra não são controles negativos.
As duas execuções e a suíte são supervisionadas e têm saídas preservadas.

```text
node <scripts>/delivery.mjs plan <id>
node <scripts>/delivery.mjs preflight <id>
node <scripts>/delivery.mjs run <id> --apply
node <scripts>/delivery.mjs check <id> implemented
node <scripts>/delivery.mjs metrics <id>
```

`plan` e `preflight` são somente leitura. O preflight verifica contrato, ledger,
operações pendentes e transporte; não afirma que executou o reporter. `run` primeiro
executa os controles reais do reporter e então uma execução completa por suíte.
Não execute novamente a suíte para cada Requirement. Os contraexemplos de QA continuam
com sua própria execução adversarial e evidência; o perfil não os substitui.

Cada invocação recebe `SPECTREE_TEST_NAMESPACE` único. O harness do consumidor deve
usá-lo no nome do banco, schema ou recursos temporários e limpar somente seus próprios
recursos. A variável sozinha não isola um banco fixo como `synd_test`.

Os registros ficam em `.spectree/delivery/<id>/<run>/`, os recibos de processos em
`.spectree/processes/`. O gate relê as saídas e compara candidato, contrato e plano.
Uma execução posterior vermelha não é substituída por uma verde anterior. A política
é aplicada no planner, em can/transition e na confirmação pós-merge. Evidência local
não substitui `ci.green` nem os demais gates existentes.

## Interrupção e fechamento

Uma execução sem resultado final bloqueia outra execução e o avanço. Inspecione os
efeitos e os processos na máquina original. Com o escritor encerrado e as fronteiras
de processos comprovadamente paradas, salve uma inspeção em `.spectree/inputs/`:

```json
{"reason":"Efeitos e recursos temporários inspecionados.","refs":[".spectree/inputs/inspection.md"]}
```

```text
node <scripts>/delivery.mjs recover <id> <run> .spectree/inputs/inspection.json --apply
```

A recuperação preserva a execução original e não declara sucesso. Execute uma nova
suíte. Processos ativos ou sem recibos observáveis continuam bloqueados: testemunho
do operador não substitui a inspeção do supervisor. O orçamento de tarefas do executor
continua separado das tentativas de verificação.

`prepare-closure` confere ledger e descoberta dos planos antes da consolidação. Planos
são encontrados pela identidade, inclusive no arquivo; duplicatas são recusadas.
Para CI, use `delivery.mjs plan <id>` e `delivery.mjs run <id> --apply`, com o pacote
disponível no runner, em vez de fixar o caminho de uma pasta que será arquivada.

A consolidação idempotente continua responsabilidade do mecanismo do consumidor.
Antes de prepará-la no candidato, o Platform Engineer deve exercitá-la duas vezes e
interromper/retomar em um canário; o preflight não executa comandos arbitrários para
tentar provar idempotência em um projeto real. A recuperação durable existente do
fechamento permanece em vigor.

Finalize `.log/platform.log` antes da preparação. Observações posteriores ficam sob
`.spectree/work` e `.spectree/delivery`, preservando a auditoria. Não retire `.log`,
documentação ou código do digest para forçar uma preparação a parecer atual.
Se a consolidação alterar o candidato, a próxima verificação deve medir esse resultado.

## Medição e limites

`metrics` informa execuções, primeira tentativa aprovada por candidato/contrato/plano,
falhas de infraestrutura, tempo observado de suíte, preparações e intervalo entre
implementação e integração. Dados de custo de modelo, fila e espera humana são `null`:
o tempo de calendário não estima nenhum deles. Use os eventos do executor para sua
telemetria de agentes. Compare amostras equivalentes antes de alegar ganho de velocidade.

TAP é o único formato aceito. O parser recusa estruturas que não compreende. O inventário
e o escopo do comando são um contrato revisado; este mecanismo não descobre todos os
testes possíveis de qualquer linguagem nem prova que o runner configurado é honesto.
Os registros locais detectam inconsistências, mas não são assinaturas contra um usuário
com poder de reescrever todo o estado. Nenhuma instalação em consumidores ocorre aqui.
