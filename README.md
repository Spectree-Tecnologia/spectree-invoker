# spectree-invoker

Plugin do Claude Code com o squad de agentes de IA da Spectree Tecnologia, orquestrado pelo **Invoker** — seis especialistas divididos por raio de destruição, isolamento de contexto e adversarialidade, para monólitos modulares spec-driven.

## Instalação

```bash
claude plugin marketplace add Spectree-Tecnologia/spectree-invoker
claude plugin install spectree@spectree-invoker
```

Para atualizar um projeto que já usa o plugin: `claude plugin update spectree@spectree-invoker`. Cada merge em `main` vira uma tag `v<versão>`, então dá para saber qual commit um projeto está rodando.

## Uso

Dentro de um projeto, `/spectree:invoker` boota o Invoker. Sem argumentos ele reporta o estado do pipeline lido do disco; com argumentos, leva o pedido para dentro do pipeline — entrevista, proposta, gate, build, verificação.

## Codex

```bash
node <pacote>/scripts/install-codex.mjs /caminho/do/projeto            # dry run, não escreve nada
node <pacote>/scripts/install-codex.mjs /caminho/do/projeto --apply
```

Invoque com `$spectree-invoker`. Os seis especialistas vão para `.codex/agents/`, que é onde o Codex procura agentes personalizados — a pasta `agents/` de uma skill não registra nada. O instalador **nunca reescreve o `AGENTS.md` do consumidor**: acrescenta um ponteiro uma vez, abaixo do que já existe. Detalhes em [docs/install.md](docs/install.md).

## O que há aqui

O **[Spectree Presence — P1](docs/presence.md)** inicia a interface conversacional: personagem Three.js, identidades por cor e expressão ligada ao áudio demonstrativo. Execute `npm ci --ignore-scripts` e `npm run presence` nesta raiz. Esta etapa usa vozes gravadas, sem microfone, harness ou acesso a projetos consumidores.

A **[Confiabilidade de Entrega 1.13](docs/delivery-reliability.md)** verifica a suíte completa contra cenários e inventário de testes, integra pendências aos marcos de entrega e registra controles reais do reporter. O fechamento descobre planos ativos e arquivados; as métricas distinguem observações de execução de custo e espera desconhecidos. A política é habilitada explicitamente no consumidor.

A **[Adoção e Reconciliação Operacional 1.11](docs/guided-reconciliation.md)** identifica divergências de instalação, configuração e estado, exige um mecanismo declarado para fechamento prepared e permite corrigir um modo de fechamento equivocado com plano auditável e retomada após interrupção. A Console apresenta o diagnóstico somente para leitura.

O **[Spectree Console](docs/console.md)** oferece uma interface local para observar o squad: `npm run console -- --project /caminho/do/projeto`. Pipeline, especialistas, tarefas, evidências e histórico, em modo somente leitura. Para explorar com dados sintéticos: `npm run console -- --demo`.

O **[Runtime Conectado 1.10](docs/runtime-connected.md)** acrescenta registros automáticos de execução, consulta ao planner, vínculos entre cenários e checks, métricas reportadas pelos adapters e um launcher instalado independente da branch.

Uma fonte, duas renderizações. `protocol/` é a única fonte autoritativa; `CLAUDE.md`, `agents/*.md`, `adapters/codex/dist/` e a skill do Codex são **gerados** e verificados contra ela no CI. O `AGENTS.md` do consumidor é preservado pelo instalador.

| Caminho | O quê |
|---|---|
| `protocol/` | O núcleo neutro de fornecedor: seções e corpos dos seis papéis. **Edite aqui.** |
| `adapters/claude-code/`, `adapters/codex/` | O que é específico de cada harness: tokens, ferramentas, metadados |
| `schemas/` | Os contratos estruturados: change, dispatch, evidence, deferred, approval |
| `scripts/` | `build`, `check-plugin`, `state`, `verify-change`, `capabilities` |
| `tests/` | Testes determinísticos, ciclos pelos CLIs instalados e fixtures de avaliação comportamental |
| `bench/` | [Medição de performance](docs/performance.md): benchmark local e observação somente leitura do GitHub; nunca autoridade para gates |
| `state.mjs plan` | [Próximo passo operacional](docs/planning.md): recomendação derivada dos gates, sem executar ações ou conceder autorização |
| `work.mjs`, `mutation-probe.mjs`, `verification.mjs` | [Retomada e verificação](docs/reliability.md): checkpoints, mutação isolada, round trips, baseline e CI independente |
| `tasks.mjs`, `reports.mjs`, `evals.mjs` | [Execução e avaliações](docs/evolution.md): tarefas com dependências, contexto por fase, diagnóstico, revisão e avaliações com agentes reais |
| `tasks.mjs budget-plan/budget-apply/preflight`, `bridge.mjs` | [Execução resiliente 1.12](docs/resilient-execution.md): revisão auditada de orçamento, fronteira coerente, classificação de falhas e entrega persistente |
| `adopt.mjs`, `tasks.mjs repair`, `evals.mjs --suite flow` | [Adoção operacional 1.8](docs/operational-adoption.md): Claude nativo, plano de adoção, supervisão de processos e avaliação do fluxo com reparo de regressão |
| `docs/` | [instalação](docs/install.md) · [compatibilidade](docs/compatibility.md) · [arquitetura](docs/architecture.md) · [ciclo de entrega](docs/workflow.md) · [manutenção](docs/maintenance.md) |
| `CLAUDE.md`, `agents/`, `adapters/codex/dist/` | **Gerados.** Rode `node scripts/build.mjs`; não edite à mão |

```bash
npm ci --ignore-scripts  # dependência local do renderer Presence
npm run check     # drift + integridade + suíte
```

Os artefatos que o squad produz nos projetos — specs, código, commits, cards — são em inglês. Tudo que chega ao Founder é em português. Este repositório é a ferramenta, não um projeto do squad: a história dele é em português.

## Como o plugin evolui

O [roadmap](docs/ROADMAP.md) registra a sequência aprovada de evolução. O próximo ciclo é o **Spectree Presence 1.14**: uma interface de conversa por voz com o Invoker e os especialistas. A [primeira entrega](docs/changes/presence-fundacao/proposal.md) estabelece a fundação visual e o contrato de estados; a integração com o harness e a voz permanecem planejadas.

Um **projeto canário** roda a metodologia de verdade, sem ninguém segurando a mão. O que o canário faz de diferente do que está escrito é achado; achado vira PR aqui, nunca correção lá. Seis dos artefatos e regras deste repositório nasceram assim — o squad inventou a guarda antes de a metodologia tê-la, e a metodologia a adotou.
