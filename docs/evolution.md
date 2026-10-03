# Execução e avaliações — ciclo 1.7

O Invoker agora pode executar uma tarefa de implementação por vez, chamar um agente
e verificar os Scenarios com testes nomeados. O plano não concede autorização nem
substitui os gates existentes. O projeto precisa de adoção estruturada, aprovação
de escopo vigente e estado que permita implementar: `pass1_complete`, ou
`baselined` em mudança explicitamente sem delta. O passe 1 global permanece.

## Plano e execução

Adapte [task-plan.json](examples/task-plan.json) aos arquivos e comandos reais.
O exemplo descreve formato; não é executável sem os artefatos do consumidor.
Declare tarefas pequenas, dependências, referências, Scenarios e caminhos.
Cada Scenario precisa de um teste TAP nomeado, comando como array e arquivos de
aceitação imutáveis. Inclua em `checks[].files` todos os helpers/configurações que
definem o oráculo. Nenhuma tarefa pode escrever esses arquivos ou as referências.

```text
node scripts/tasks.mjs init <change> <plan.json>
node scripts/tasks.mjs status <change>
node scripts/tasks.mjs run <change> <task> --adapter docs/examples/codex-runner.json --apply
node scripts/tasks.mjs verify <change> --apply
```

Na instalação Codex, substitua `scripts/` por `.spectree/squad/scripts/` e o caminho
do exemplo por `.spectree/squad/docs/examples/codex-runner.json`. No plugin Claude,
use a raiz do plugin. O diretório de trabalho é sempre o consumidor; também pode
ser declarado por `SPECTREE_PROJECT_ROOT`.

O adapter nativo chama `codex exec --json --ephemeral --sandbox workspace-write`,
envia o packet por stdin e exige um evento de conclusão de turno sem erro. Usa o
modelo configurado no CLI, ou `model` explícito no JSON; não inventa qual modelo o
default resolveu. Exige login existente e uma versão do CLI com essas opções.
Referência: [modo não interativo oficial](https://developers.openai.com/codex/noninteractive).

Outro harness pode ser integrado por um bridge local confiável:
`{"kind":"bridge","command":["node","bridge.mjs"],"timeout_seconds":300}`.
Use `"context_adapter":"claude-code"` quando esse bridge transportar missões Claude;
o padrão é `codex`. Isso seleciona as instruções geradas, não declara isolamento.
Recebe o packet JSON no stdin e retorna um envelope JSON no stdout, por exemplo
`{"status":"completed"}`. O bridge implementa permissões e transporte reais;
o envelope não prova sucesso. Não existe adapter Claude CLI nativo neste ciclo.

O executor mantém um lock por checkout e o lock de autoridade da mudança, registra
tentativa/dispatch/checkpoint e só depois chama o agente. Executa os testes da
tarefa e das tarefas já concluídas, detecta alterações fora dos caminhos declarados
entre arquivos rastreados/não ignorados e confere que contrato, aceitação,
autoridade, revisão e branch continuam válidos. Testes que alterem o candidato,
TAP vazio, testes pulados, erro de processo ou quota não produzem sucesso.

Os resultados em `.spectree/tasks/` ligam Scenario, teste, comando, resultado,
revisão e digest. Qualquer mudança de candidato invalida a evidência da tarefa;
`verify --apply` reexecuta os checks concluídos. Um plano importado não é sobrescrito
para resetar orçamento. Mudanças no contrato/oráculo exigem replanejamento explícito;
neste primeiro ciclo não há migração automática de um plano já iniciado.

## Retomada

Após falha, timeout ou interrupção, `status` não libera a próxima tarefa. Inspecione
arquivos, processos, registros e efeitos externos antes de repetir qualquer coisa.
O timeout limita a espera do launcher; não garante terminar todos os descendentes.
Prepare um JSON de inspeção:

```json
{
  "cause": "Resultado interrompido; arquivo inspecionado e efeitos identificados.",
  "new_hypothesis": "Continuar a implementação faltante, sem repetir o efeito já aplicado.",
  "refs": ["caminho/artefato-inspecionado"],
  "processes_stopped": true
}
```

Execute `tasks.mjs recover <change> <attempt> --inspection <json>`. O booleano é uma
declaração explícita do operador, não prova automática da árvore de processos. Um
lock abandonado só é removido quando o PID proprietário está comprovadamente morto
na mesma máquina. A reconciliação não declara sucesso nem zera tentativas. Operações
de `verify` interrompidas usam `work.mjs reconcile`; um executor morto pode deixar
um lock que precisa de inspeção operacional antes de remoção manual.

## Contexto, diagnóstico e revisão

`protocol/runtime/{core,implement,diagnose,review}.md` gera os perfis dos dois
adapters. O packet inclui núcleo e fase, hashes e referências focadas, com limite
de 64 KiB de conteúdo referenciado. Preserve nas referências a convenção do módulo
e os critérios necessários. O perfil de implementação também inclui a card completa
do Developer, gerada da mesma fonte. O protocolo completo continua disponível e autoritativo;
estes perfis não alegam reduzir o contexto que o harness carrega automaticamente.

`reports.mjs diagnosis <json>` e `reports.mjs review <json>` validam versão 1 e
`candidate` com `revision` e `content_digest` atuais. Diagnóstico exige `symptom`,
`environment`, `hypotheses` (id/claim/prediction), `observations`
(hypothesis/command/attempts/failures/intervention/refs) e `conclusion`:
`inconclusive` ou `cause_supported`, este último com índices em
`supporting_observations`. Revisão exige arrays `spec` e `standards`; cada achado
contém `claim`, `basis`, `kind` (blocker/suggestion/inconclusive) e `refs`.
Blocker também exige `failing_command` e `observed_failure`.

Esses validadores verificam consistência e identidade, não executam as experiências,
não certificam causalidade e não fecham M4 (isolamento do QA).

## Avaliações reais

```text
node scripts/evals.mjs
node scripts/evals.mjs --adapter docs/examples/codex-runner.json --output <diretorio-de-resultados> --apply
```

Sem `--apply`, só lista os casos. Com ele, cria repositórios temporários novos e
chama o CLI autenticado, consumindo uso do modelo. Nenhum caminho de projeto real
é aceito como fixture. Os cinco incidentes sintéticos cobrem quota disfarçada de
conclusão, evidência obsoleta, baseline intermitente, oráculo insensível e controle
positivo de evidência válida. Esperados ficam no grader, fora do packet.

O agente escreve `decision.json`; o grader confere decisão, envelope e preservação
da fixture. Isso mede decisões reais delimitadas e disciplina de escrita, não uma
entrega completa do squad, nem independência de capacidades. O modo
`transport-test` aceita bridges para testar transporte; seu resultado nunca deve
ser apresentado como avaliação de agente. A suíte normal de testes não consome API.

No repositório do Invoker, `node evals/executor-smoke.mjs --apply` também executa
uma implementação mínima pelo Codex real, seguida de aceitação TAP observada pelo
executor. Os pré-requisitos de lifecycle dessa fixture são semeados explicitamente;
o smoke não valida a obtenção de aprovações nem o pipeline inteiro. Sem `--apply`,
apenas informa o procedimento. Esse harness de desenvolvimento não é instalado no consumidor.

Cada run registra versão, digest da suíte/perfil, modelo solicitado, tokens quando
reportados, duração, saída bruta e resultados por caso. Ausência de uso é `null`,
não zero. Fixtures e logs são preservados para inspeção; revise retenção e eventual
conteúdo sensível antes de compartilhar. Use somente casos sintéticos. Resultados
parciais persistem a cada caso. Compare repetições equivalentes antes de afirmar
melhoria; um único verde não prova ganho nem autoriza roteamento de modelos.

## Limites do incremento

O escopo de caminhos é uma detecção posterior sobre arquivos Git rastreados/não
ignorados, não uma sandbox de capacidades. Não detecta todo efeito em arquivos
ignorados, fora do checkout ou em serviços externos. O harness precisa aplicar suas
permissões reais. Os comandos de verificação e bridges são código confiável escolhido
pelo operador; a declaração de arquivos do oráculo não analisa toda a árvore de imports.
Arquivos locais de estado não são uma fronteira contra um agente malicioso com shell.

O executor não faz deploy, merge, fechamento, concorrência de agentes, worktrees,
roteamento automático de modelos ou isolamento verificável do QA. Esses itens
dependem de ciclos posteriores e evidência própria. Não há promessa de efeitos
externos exatamente uma vez.

Quando há plano registrado, `state.mjs can/transition <change> implemented` também
exige todas as tarefas verificadas no candidato atual, inclusive sob o lock da
transição. O planner continua recomendando implementar enquanto essa etapa estiver
aberta; sua recomendação não declara a implementação concluída.

As práticas foram inspiradas na [análise de mattpocock/skills](analysis/2026-10-02-matt-pocock-skills-review.md).
Implementação e textos deste incremento foram escritos para o protocolo do Invoker.
