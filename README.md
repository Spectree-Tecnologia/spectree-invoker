# Spectree Invoker

**Um squad de agentes de IA que só considera pronto o que um comando provou.**

[![CI](https://github.com/Spectree-Tecnologia/spectree-invoker/actions/workflows/check.yml/badge.svg?branch=main)](https://github.com/Spectree-Tecnologia/spectree-invoker/actions/workflows/check.yml)
[![Versão](https://img.shields.io/github/v/tag/Spectree-Tecnologia/spectree-invoker?sort=semver&label=vers%C3%A3o)](https://github.com/Spectree-Tecnologia/spectree-invoker/tags)
[![Licença: MIT](https://img.shields.io/badge/licen%C3%A7a-MIT-blue.svg)](LICENSE)
![Node.js ≥ 20.11](https://img.shields.io/badge/node-%E2%89%A5%2020.11-339933?logo=node.js&logoColor=white)
![Claude Code](https://img.shields.io/badge/Claude%20Code-plugin-D97757)
![OpenAI Codex](https://img.shields.io/badge/OpenAI%20Codex-skill%20%2B%20agentes-412991)

O **Invoker** é o TechLead de um squad de agentes de IA para o **Claude Code** e o **OpenAI Codex**. Ele recebe o seu pedido, entrevista antes de propor, despacha seis especialistas e leva a mudança da ideia ao merge — com cada passo travado por uma máquina de estados que **recusa avançar sem evidência** produzida por um comando e presa à revisão em que rodou.

Feito para monólitos modulares guiados por especificação. Um protocolo, dois harnesses, nenhuma dependência de API paga para funcionar.

---

## Por que existe

Um agente de código sozinho é ansioso: transforma um pedido vago em código confiante e errado, declara "pronto" sobre o próprio trabalho e aprova o que ele mesmo construiu. O Invoker troca confiança por prova.

| Sem o squad | Com o Invoker |
|---|---|
| O agente declara que terminou | Cada transição exige evidência produzida por um comando, vinculada à revisão em que rodou |
| Pedido vago vira código confiante e errado | A exploração entrevista antes de propor — **uma pergunta por vez** |
| Quem constrói é quem aprova | O Quality Engineer ataca em **contexto isolado** e entrega um teste que falha, nunca uma opinião |
| O requisito se perde entre a conversa e o código | Spec viva, alterada por delta; cada `Scenario` vira um teste |
| O fechamento gera PRs e commits de "o CI passou" | **Um PR por mudança**; a confirmação pós-merge produz um recibo, não um commit |
| O humano aprova tudo — e passa a aprovar sem ler | Você entra em **três gates**: escopo, ambiguidade comprovada e o que é irreversível |

## O squad

Os papéis não seguem o organograma. Seguem três fronteiras com consequência física: **raio de destruição**, **isolamento de contexto** e **adversarialidade**.

| Agente | Entrega | Fronteira |
|---|---|---|
| **Invoker** | despacho, verificação independente, o relatório para você | orquestra; não escreve código |
| **Solutions Architect** | entrevista, proposta, delta da spec e mapa de módulos | descoberta, arquitetura e UX num papel só |
| **Full Stack Developer** ×N | o módulo, com os testes que provam cada `Scenario` | um por módulo, em paralelo |
| **Quality Engineer** | um teste que falha — nunca uma opinião | adversário, em contexto isolado |
| **Platform Engineer** | branch, CI, banco, migração, merge e deploy | o único com raio de destruição em git, banco e produção |
| **Integration Engineer** | um fato sobre um sistema externo, com fonte citada | a rota geral para a rede; não escreve nada |
| **TypeSafe Engineer** | julgamentos tipados com o Jev, com calibração medida | opcional: só quando a stack aprovada inclui TypeSafe |

## Como funciona

```mermaid
flowchart LR
    subgraph D["1 · Definir"]
        direction TB
        A([Seu pedido]) --> B[Exploração<br/>uma pergunta por vez]
        B --> C[Proposta + delta da spec<br/><i>Solutions Architect</i>]
        C --> G1{{Gate 1 · escopo}}
    end
    subgraph B2["2 · Construir"]
        direction TB
        E1[Branch + baseline verde<br/><i>Platform Engineer</i>] --> E2[Passe 1 · um teste<br/>falhando por Scenario<br/><i>Quality Engineer</i>]
        E2 --> E3[Implementação por módulo<br/><i>Full Stack Developers</i>]
        E3 --> E4[Fechamento preparado<br/>na própria branch]
    end
    subgraph I["3 · Integrar"]
        direction TB
        I1[Passe 2 · ataque e<br/>auditoria de escopo<br/><i>Quality Engineer</i>] --> I2[CI verde]
        I2 --> G2{{Aprovação de integração}}
        G2 --> I3[Um merge]
        I3 --> I4([Confirmação pós-merge<br/>recibo → closed])
    end
    D --> B2 --> I
```

Cada seta é uma transição da máquina de estados (`state.mjs`). Ela confere a evidência que o estado de destino exige; um teste que passou antes de uma edição não vale depois dela, e um "pronto" num checklist não autoriza nada. O ciclo completo está em [docs/workflow.md](docs/workflow.md).

## Início rápido

**Requisitos:** Node.js ≥ 20.11 e Git. Para a confirmação pós-merge, a [GitHub CLI](https://cli.github.com/) (`gh`) autenticada.

### Claude Code

```bash
claude plugin marketplace add Spectree-Tecnologia/spectree-invoker
claude plugin install spectree@spectree-invoker
```

Dentro de um projeto, rode `/spectree:invoker`. Sem argumento, ele relata o estado do pipeline lido do disco; com argumento, leva o pedido para dentro do pipeline.

```text
/spectree:invoker Quero um módulo de cobrança via Pix
```

Para atualizar: `claude plugin update spectree@spectree-invoker`. Cada merge na `main` publica uma tag `v<versão>`, então dá para saber exatamente qual commit um projeto está rodando.

### OpenAI Codex

O instalador roda em modo de simulação por padrão e só escreve com `--apply`:

```bash
git clone https://github.com/Spectree-Tecnologia/spectree-invoker
node spectree-invoker/scripts/install-codex.mjs /caminho/do/projeto            # mostra o plano
node spectree-invoker/scripts/install-codex.mjs /caminho/do/projeto --apply    # instala
```

Depois, invoque com `$spectree-invoker`. Os especialistas vão para `.codex/agents/`, onde o Codex procura agentes personalizados. O instalador **nunca reescreve o seu `AGENTS.md`**: acrescenta um ponteiro, uma vez, abaixo do que já existe. Para atualizar, rode de novo com `--apply --force`. Detalhes em [docs/install.md](docs/install.md).

## Veja funcionando

Duas interfaces locais rodam a partir de um clone deste repositório.

```bash
npm run console -- --demo                     # Spectree Console com dados sintéticos
npm ci --ignore-scripts && npm run presence   # Spectree Presence, demonstração
```

- **[Spectree Console](docs/console.md)** — observa o squad em modo somente leitura: pipeline, especialistas, tarefas, evidências e histórico. Aponte para um projeto real com `npm run console -- --project /caminho/do/projeto`. O endereço impresso carrega uma credencial temporária da sessão; não o compartilhe.
- **[Spectree Presence](docs/presence.md)** — a fundação da interface de conversa por voz com o squad: personagem 3D, identidade por cor e estados explícitos. Nesta versão o áudio é gravado; não há microfone, harness nem acesso a projetos.

## O que está comprovado — e o que não está

Este repositório prefere escrever *implementado, validação real pendente* a escrever *compatível*.

- ✅ **Claude Code desktop e OpenAI Codex Desktop** carregaram o squad em sessões reais: boot, despacho de especialista e recusa de gate.
- ✅ **Ciclo contra o GitHub real**: um PR, um merge e a confirmação pós-merge com recibo. Um merge cujo conteúdo não era o candidato aprovado foi recusado sem recibo e sem mudança de estado.
- ✅ **Isolamento de contexto do Quality Engineer no Claude Code**, observado por sonda de despacho com braço de controle: ele não recebe a conversa nem o raciocínio de quem construiu. É isolamento de contexto, não sandbox — ele ainda compartilha o sistema de arquivos e o histórico do git.
- ⏳ **Isolamento no Codex**: ainda não sondado. Até ser, o passe 2 fica bloqueado lá.
- ⏳ **Tempo de entrega**: a estrutura (um PR, um merge, nada depois) é testada; o tempo de relógio ainda é hipótese.
- ⏳ **macOS**: nunca executado.

O registro completo, com o que rodou, onde e como, está em [docs/compatibility.md](docs/compatibility.md) e [docs/maintenance.md](docs/maintenance.md).

## Estrutura do repositório

Uma fonte, duas renderizações: `protocol/` é a única fonte autoritativa, e o que cada harness lê é **gerado** a partir dela e verificado no CI.

| Caminho | Conteúdo |
|---|---|
| `protocol/` | O núcleo neutro de fornecedor: as seções do protocolo e o corpo de cada papel. **Edite aqui.** |
| `adapters/claude-code/`, `adapters/codex/` | O que é específico de cada harness: tokens, ferramentas, metadados |
| `CLAUDE.md`, `agents/`, `adapters/codex/dist/` | **Gerados.** Rode `npm run build`; nunca edite à mão |
| `schemas/` | Os contratos estruturados: mudança, despacho, evidência, aprovação, adiamento, preparação e recibo |
| `scripts/` | A linha de comando do squad — veja a tabela abaixo |
| `tests/`, `evals/` | Suíte determinística e avaliações com agentes reais em projetos sintéticos |
| `console/`, `presence/` | As duas interfaces locais |
| `bench/` | [Medição de performance](docs/performance.md), nunca autoridade para gates |
| `docs/` | A documentação, abaixo |

### Linha de comando

| Comando | Para quê |
|---|---|
| `state.mjs` | A máquina de estados: abrir mudanças, registrar evidência e aprovações, transitar, [planejar o próximo passo](docs/planning.md) |
| `prepare-closure.mjs`, `post-merge.mjs` | Preparar o fechamento na branch e [confirmar o merge com recibo](docs/workflow.md) |
| `capabilities.mjs` | O que este harness de fato oferece ao squad, e com que grau de certeza |
| `work.mjs`, `verification.mjs`, `mutation-probe.mjs` | [Retomada e verificação](docs/reliability.md): checkpoints, plano de verificação, mutação em cópia descartável |
| `tasks.mjs`, `reports.mjs`, `evals.mjs` | [Execução e avaliações](docs/evolution.md): tarefas com dependências, diagnóstico e revisão; [execução resiliente](docs/resilient-execution.md) |
| `delivery.mjs` | [Confiabilidade de entrega](docs/delivery-reliability.md): a suíte inteira contra os cenários e o inventário de testes |
| `adopt.mjs`, `reconcile.mjs` | [Adoção operacional](docs/operational-adoption.md) e [reconciliação guiada](docs/guided-reconciliation.md) de projetos existentes |
| `install-codex.mjs` | O instalador para o Codex |

## Desenvolvimento

```bash
npm ci --ignore-scripts   # dependência local do renderer do Presence
npm run build             # regenera os artefatos a partir de protocol/
npm run check             # deriva + integridade + suíte — o mesmo portão do CI
```

Contribuições são bem-vindas; leia o [guia de contribuição](CONTRIBUTING.md) antes de abrir um PR. Os artefatos que o squad produz nos projetos — specs, código, commits, cards — são em inglês. Tudo que chega a você é em português. Este repositório é a ferramenta, não um projeto do squad: a história dele é em português.

## Documentação

- **Começar** — [instalação, verificação, atualização e remoção](docs/install.md) · [compatibilidade](docs/compatibility.md)
- **Entender** — [arquitetura](docs/architecture.md) · [ciclo de entrega](docs/workflow.md) · [manutenção e limites conhecidos](docs/maintenance.md)
- **Operar** — [próximo passo](docs/planning.md) · [retomada e verificação](docs/reliability.md) · [execução e avaliações](docs/evolution.md) · [execução resiliente](docs/resilient-execution.md) · [confiabilidade de entrega](docs/delivery-reliability.md) · [runtime conectado](docs/runtime-connected.md)
- **Projetos existentes** — [adoção operacional](docs/operational-adoption.md) · [reconciliação guiada](docs/guided-reconciliation.md)
- **Interfaces** — [Console](docs/console.md) · [Presence](docs/presence.md)

## Como o plugin evolui

O [roadmap](docs/ROADMAP.md) registra a sequência aprovada de evolução do **Spectree Presence**: uma interface de conversa por voz com o Invoker e os especialistas. A versão **1.14.0** contém a [primeira entrega](docs/changes/presence-fundacao/proposal.md), com a fundação visual demonstrativa e o contrato de estados; a integração real com o harness e a voz permanecem planejadas.

Um **projeto canário** roda a metodologia de verdade, sem ninguém segurando a mão. O que o canário faz de diferente do que está escrito é achado; achado vira PR aqui, nunca correção lá. Seis dos artefatos e regras deste repositório nasceram assim — o squad inventou a guarda antes de a metodologia tê-la, e a metodologia a adotou.

## Licença

[MIT](LICENSE) © 2026 Spectree Tecnologia
