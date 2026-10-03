# Ciclo 1.8 — adoção operacional

Base: `b75ebd250927373888992165f1570abecfa45cb4` (1.7.0).
Implementação na branch `codex/adocao-runtime-1-8`. O consumidor
`spectree-workspace` não recebeu escrita, instalação, build ou teste.

## Entrega

- Adapter Claude Code nativo: stdin, eventos estruturados, sessão efêmera,
  ferramentas declaradas, safe mode, tratamento de quota/erros/negações e contexto Claude.
- Adoção assistida: plano revisável com hashes, preservação de configuração e
  artefatos, rejeição de drift e registro exclusivo de um draft novo.
- Supervisor: Job Objects no Windows e grupos de processos em POSIX, recibos
  duráveis e bloqueio de recuperação quando o encerramento não pode ser observado.
- Reparo explícito de regressões: referências inspecionadas, orçamento original,
  reconciliação prévia e aceitação de todas as tarefas já implementadas.
- Avaliação de fluxo: lifecycle real desde draft, política sintética identificada,
  branch, baseline, testes vermelhos, interrupção, dependências e reparo.

O fluxo revelou uma lacuna da 1.7: após uma falha tornar evidências anteriores
obsoletas, a fronteira normal bloqueava a correção. `tasks repair` resolve esse
caso sem remover o gate, resetar orçamento ou permitir mudanças no oráculo.

## Evidência observada

O [registro de execuções](2026-10-03-live-operational-flows.json) preserva sucessos
e falhas, hashes dos logs, durações e uso informado pelos CLIs.

Claude Code 2.1.234 concluiu as três missões reais do fluxo (A, B e reparo), com
`claude-sonnet-5` informado pelo CLI. A aceitação observou ambos os Scenarios,
detectou a regressão injetada e confirmou o reparo. O lifecycle chegou a implemented
e o gate de QA permaneceu bloqueado. Um controle positivo da suíte de decisões
também passou com Claude nativo.

Codex foi interrompido por `usage limit` durante A. A árvore supervisionada encerrou,
nenhum sucesso foi registrado e B permaneceu bloqueada. Essa execução valida o
tratamento da interrupção observada, mas não valida um fluxo completo com Codex
na 1.8. Não houve repetição para contornar o limite da conta.

São execuções de desenvolvimento, identificadas por digest do runtime, anteriores
aos ajustes finais de revalidação/registro. A suíte determinística valida o código
final. Não são comparações de modelos nem medição de ganho em produção. A política,
o plano e os oráculos são fixtures; não se alega que agentes criaram esses artefatos
ou que exista isolamento comprovado de QA.

## Falhas encontradas durante validação

O primeiro teste focado detectou duas recusas transitórias: a contagem do Job
Object podia demorar a refletir o término de workers. O supervisor agora observa
um intervalo limitado de drenagem antes de classificar filhos remanescentes;
continuam sendo encerrados e recusados quando realmente permanecem ativos.

A primeira suíte completa teve 339/343 testes aprovados. As quatro falhas foram:

- Benchmark com deadline de 120 segundos sob concorrência alta. Com concorrência
  limitada a quatro arquivos, o benchmark passou em aproximadamente 33 segundos.
- Fixture de filho remanescente: o launcher Node no Windows podia encerrá-lo ao
  terminar o pai. A fixture agora separa o filho do job do Node, mantendo-o no
  Job Object do supervisor; assim mede o supervisor efetivamente.
- Remoção de fixture em teste de concorrência com `EPERM` no Windows; a nova rodada
  com concorrência limitada passou sem reproduzir a falha, sem alterar o gate testado.
- A checagem de processos em `verify` chamava a leitura das evidências antigas,
  impedindo regenerar evidência corrompida. A inspeção de processos foi separada
  da validação dessas evidências; a reexecução continua exigindo trabalho reconciliado.

A suíte completa com concorrência limitada passou: **343/343**, aproximadamente
243 segundos no Windows. O pacote mantém esse limite em `npm test`, também usado
no CI. O protocolo e os artefatos gerados continuam consistentes. Consulte
[o guia operacional](../operational-adoption.md) para comandos e limites de cobertura.
