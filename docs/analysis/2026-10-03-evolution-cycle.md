# Ciclo de evolução 1.7.0 — resultado

Concluído em 03/10/2026. Versão local, sem commit, publicação ou instalação no
`spectree-workspace`. As alterações locais do ciclo anterior foram preservadas.

## Entrega

- Executor sequencial de tarefas de implementação, com dependências, plano
  persistente, tentativa antes do efeito, locks, orçamento e reconciliação explícita.
- Adapter Codex CLI real e contrato de bridge para outros harnesses. O bridge não
  é apresentado como integração Claude CLI já validada.
- Verificação por Scenario e teste TAP nomeado; reexecução das tarefas concluídas
  quando uma nova tarefa muda o candidato; identidade e hash do arquivo de evidência.
- Recusa de `implemented` se o plano adotado tem tarefas não verificadas, pendências
  ou evidência obsoleta. Nenhuma transição é feita automaticamente pelo executor.
- Contexto por fase, gerado da fonte do protocolo para os dois adapters. O perfil
  de implementação transporta também a card do Developer.
- Validadores de consistência para diagnóstico e revisão em dois eixos. Eles não
  apresentam declarações como execução observada nem certificam causalidade.
- Runner de avaliações reais, cinco incidentes sintéticos e smoke de implementação.
- Instalador, entrypoints, integridade do pacote, exemplos e [manual](../evolution.md).

## Validação observada

| Verificação | Resultado | Limite |
|---|---|---|
| `npm run check` | 332 testes passaram; drift e integridade passaram | Execução completa antes dos últimos ajustes de integridade de evidência |
| Testes direcionados após os ajustes finais | 20 passaram, sem falhas ou skips | Incluem executor, instalação, relatórios, grader e transporte |
| `build --check` e `check-plugin` | Passaram | Consistência estrutural, não comportamento de agentes |
| `git diff --check` | Passou | Check de whitespace dos arquivos acompanhados pelo Git |
| Cinco avaliações com Codex real | 5/5 passaram | Uma rodada, decisões delimitadas em incidentes sintéticos |
| Smoke do executor com Codex real, versão final | Passou | Pré-requisitos do lifecycle semeados como fixtures |

Os testes novos incluem morte real do processo executor após escrever um arquivo:
a retomada preservou a tentativa e exigiu reconciliação. Também cobrem quota dentro
de envelope completed, dependências, orçamento, alterações fora do escopo, alteração
dos testes, regressão introduzida por tarefa posterior, evidência removida/alterada,
reverificação vermelha, recuperação e impedimento de conclusão prematura.

[Resultado das avaliações reais](2026-10-03-live-agent-evaluations.json):
quota-envelope, stale-candidate, intermittent-baseline, insensitive-oracle e
valid-candidate. O grader compara decisões efetivamente produzidas pelo agente e
verifica preservação da fixture. O caso positivo evita premiar uma recusa universal.
Versão, hashes, tokens reportados, duração e referências aos diretórios sintéticos
estão no JSON. O modelo solicitado foi o default do CLI; não inferimos seu nome.

[Smoke final](2026-10-03-live-executor-smoke.json): o agente real alterou somente
`src/math.cjs`, de identidade para incremento. O executor executou a aceitação e
observou PASS, sem alterações de autoridade ou branch. A tarefa ficou verificada;
o lifecycle permaneceu em `pass1_complete`. Isso demonstra a separação entre
execução/verificação da tarefa e avanço formal da mudança.

Os registros brutos e fixtures desses runs permanecem nos diretórios temporários
indicados pelos JSONs. Os resumos acima foram preservados neste repositório. Não
houve testes, builds, escrita de estado ou alterações no consumidor de produção.

## Limites que continuam explícitos

Não há medição comparável antes/depois suficiente para afirmar economia de tokens
ou tempo. Essas avaliações não representam uma entrega completa em produção.
O executor inicial não faz paralelismo, worktrees, merge, deploy ou seleção automática
de modelos. M4 permanece aberto: contexto separado não prova isolamento do QA.
O escopo de arquivos é conferido depois da execução; permissões preventivas dependem
do harness. O timeout não prova encerramento de todos os processos descendentes.

O próximo passo operacional, separado desta entrega, é planejar a adoção estruturada
no consumidor e observar uma mudança real com o novo runtime. Isso requer permissão
de escrita naquele projeto; a autorização atual continua somente leitura.
