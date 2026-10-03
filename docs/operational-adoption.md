# Adoção operacional — 1.8

## Claude Code nativo

`tasks.mjs run` e `evals.mjs` aceitam [claude-runner.json](examples/claude-runner.json).
O CLI precisa estar autenticado e suportar `-p`, `--safe-mode`, saída `stream-json`,
`--no-session-persistence`, `--tools` e `--permission-mode dontAsk`. Validado com
Claude Code 2.1.234; versões anteriores que não tenham essas opções falham sem
fallback silencioso. O packet entra por stdin e usa o perfil `claude-code`.
O modelo vem da configuração existente ou do campo `model`; o runtime não adivinha
qual modelo o alias/default escolheu. A saída registra `modelUsage` quando disponível.

O adapter permite Read/Glob/Grep/Edit/Write. `allowed_tools` pode incluir Bash quando
isso fizer parte da missão autorizada; sem ele, a aceitação continua sendo executada
pelo runtime. `read_only` limita ferramentas a Read/Glob/Grep. Safe mode desliga
customizações automáticas, inclusive hooks/MCP/plugins; o perfil e a card gerados
viajam no packet. Não usa bypass de permissões nem bare mode, que exigiria API key
em vez do login por assinatura. Um resultado final ausente, erro, quota ou negação
de ferramenta nunca conta como sucesso.

Referências: [CLI oficial](https://code.claude.com/docs/en/cli-reference) e
[execução programática](https://code.claude.com/docs/en/headless). A detecção de
escopo continua sendo posterior à execução, não uma sandbox de arquivos.

## Adoção de consumidor legado

Adapte [adoption-request.json](examples/adoption-request.json), com identidade,
próxima mudança, escopo, caminhos, referências, adapter e modo de fechamento.
No diretório do consumidor, usando o caminho real do pacote instalado:

```text
node <pacote>/scripts/adopt.mjs plan request.json --output .spectree/adoption-plans/next.json
node <pacote>/scripts/adopt.mjs apply .spectree/adoption-plans/next.json --apply
```

Revise o plano antes de aplicar. Planejamento sem `--output` só imprime JSON.
O plano contém inventário, referências com hashes, candidato e digest do estado
ignorado pelo Git. A aplicação recusa drift, edição do plano, troca de identidade,
IDs existentes e sobreposição de arquivos. Configuração existente é preservada.
Ela registra somente um draft novo; arquivos arquivados permanecem artefatos,
sem aprovações ou recibos históricos. Baseline, aprovação e testes usam os gates normais.

Em uma instalação nova, declare depois os comandos de consolidação e a identidade
do CI conforme o consumidor; a adoção lista essas pendências sem inferi-los.
Não rode a aplicação em paralelo com outras alterações de estado. A proveniência
`adoptions/<id>.json` é gravada antes do estado; `-completed.json` marca a conclusão.
Se houver falha parcial, inspecione os arquivos criados. Reexecutar nunca sobrescreve
uma adoção parcial nem presume que ela terminou. Não há migração de histórico.

## Supervisão e reparo

Agentes e checks do executor geram requests/receipts em `.spectree/processes/`.
No Windows, o launcher cria o processo suspenso, associa a um Job Object sem
breakaway e só então libera execução. Timeout, excesso de saída ou morte do dono
encerram o job. O handle não é herdado; a morte do supervisor também fecha o job.
O retorno exige observação de zero processos ativos. Um pai que sai deixando
filhos ativos tem seus filhos encerrados e não é aceito como sucesso.
O helper usa Windows PowerShell com política de execução apenas no processo,
sem alterar configuração do sistema. Ambientes que bloqueiam Add-Type/Job Objects
falham de forma explícita. [Semântica de Job Objects](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects).

Em POSIX, há um supervisor de grupo de processos. Sessões separadas, comandos
delegados a serviços/WMI, jobs remotos e efeitos externos estão fora da cobertura;
as missões os proíbem. Não é isolamento contra código hostil. Um recibo ausente,
corrompido ou inconclusivo bloqueia retomada automática. Registros da 1.7 sem
supervisão continuam exigindo inspeção manual; não recebem prova retroativa.

Após inspecionar e reconciliar a falha, use a execução normal se a fronteira estiver
pronta. Quando uma regressão tornou evidências obsoletas, use reparo explícito:

```text
node <pacote>/scripts/tasks.mjs repair <change> <task> --adapter runner.json --inspection inspection.json --apply
```

`inspection.json` contém `cause`, `new_hypothesis` e `refs` de evidências inspecionadas.
O reparo exige tarefa já tentada, dependências previamente implementadas, ausência
de trabalho pendente/processos ativos e orçamento restante. Não troca plano,
contrato, caminhos nem oráculos. Reexecuta também a aceitação das tarefas anteriores.

## Avaliação do fluxo

```text
node <pacote>/scripts/evals.mjs --suite flow
node <pacote>/scripts/evals.mjs --suite flow --adapter runner.json --output <resultados> --apply
```

Cria sempre um repositório temporário novo. Parte de draft pela adoção, registra
política sintética explícita, observa branch/baseline/testes vermelhos pelos CLIs,
interrompe uma tentativa por deadline, reconcilia, implementa A e B com dependência,
injeta regressão, comprova a falha, pede reparo ao agente e verifica ambos os Scenarios.
Só então transita para implemented. A avaliação exige que o gate de QA continue
bloqueado. Não semeia pass1_complete e não inventa independência de QA, CI ou merge.

O primeiro deadline de um segundo testa o launcher interrompido; não garante que
o modelo tenha iniciado inferência ou feito uma escrita. O teste determinístico
de morte após escrita cobre o outro caso. Planos e oráculos são fornecidos pela
fixture, não criados pelo agente. É uma avaliação de fluxo de implementação, não
uma entrega completa do squad. `transport-test` usa bridges sem consumir modelos
e seus resultados não são evidência de desempenho real. Os logs persistem por
etapa, inclusive quando uma execução falha. Não apague falhas ao comparar modelos.
