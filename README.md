# spectree-invoker

Plugin do Claude Code com o squad de agentes de IA da Spectree Tecnologia, orquestrado pelo **Invoker** — cinco especialistas divididos por raio de destruição, isolamento de contexto e adversarialidade, para monólitos modulares spec-driven.

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

Invoque com `$spectree-invoker`. Os cinco especialistas vão para `.codex/agents/`, que é onde o Codex procura agentes personalizados — a pasta `agents/` de uma skill não registra nada. O instalador **nunca reescreve o `AGENTS.md` do consumidor**: acrescenta um ponteiro uma vez, abaixo do que já existe. Detalhes em [docs/install.md](docs/install.md).

## O que há aqui

Uma fonte, duas renderizações. `protocol/` é a única fonte autoritativa; `CLAUDE.md`, `agents/*.md`, `AGENTS.md` e a skill do Codex são **gerados** e verificados contra ela no CI.

| Caminho | O quê |
|---|---|
| `protocol/` | O núcleo neutro de fornecedor: seções e corpos dos cinco papéis. **Edite aqui.** |
| `adapters/claude-code/`, `adapters/codex/` | O que é específico de cada harness: tokens, ferramentas, metadados |
| `schemas/` | Os contratos estruturados: change, dispatch, evidence, deferred, approval |
| `scripts/` | `build`, `check-plugin`, `state`, `verify-change`, `capabilities` |
| `tests/` | 100 testes determinísticos + fixtures de avaliação comportamental |
| `docs/` | [instalação](docs/install.md) · [compatibilidade](docs/compatibility.md) · [arquitetura](docs/architecture.md) |
| `CLAUDE.md`, `agents/`, `adapters/codex/dist/` | **Gerados.** Rode `node scripts/build.mjs`; não edite à mão |

```bash
npm run check     # drift + integridade + suíte
```

Os artefatos que o squad produz nos projetos — specs, código, commits, cards — são em inglês. Tudo que chega ao Founder é em português. Este repositório é a ferramenta, não um projeto do squad: a história dele é em português.

## Como o plugin evolui

Um **projeto canário** roda a metodologia de verdade, sem ninguém segurando a mão. O que o canário faz de diferente do que está escrito é achado; achado vira PR aqui, nunca correção lá. Seis dos artefatos e regras deste repositório nasceram assim — o squad inventou a guarda antes de a metodologia tê-la, e a metodologia a adotou.
