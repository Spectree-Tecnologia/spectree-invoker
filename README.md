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

## O que há aqui

| Caminho | O quê |
|---|---|
| `CLAUDE.md` | A definição do Invoker: os cinco tipos de agente, os invariantes de arquitetura, o formato dos artefatos, os três gates, o formato de saída. **É o main loop; não tem card porque nada o despacha.** |
| `agents/` | Os cinco cards: Solutions Architect, Full Stack Developer, Quality Engineer, Platform Engineer, Integration Engineer. |
| `commands/invoker.md` | O comando que boota o Invoker e o manda ler a própria definição. |
| `scripts/check-plugin.mjs` | O check de sanidade do plugin, rodado em CI. |

Os artefatos que o squad produz nos projetos — specs, código, commits, cards — são em inglês. Tudo que chega ao Founder é em português. Este repositório é a ferramenta, não um projeto do squad: a história dele é em português.

## Como o plugin evolui

Um **projeto canário** roda a metodologia de verdade, sem ninguém segurando a mão. O que o canário faz de diferente do que está escrito é achado; achado vira PR aqui, nunca correção lá. Seis dos artefatos e regras deste repositório nasceram assim — o squad inventou a guarda antes de a metodologia tê-la, e a metodologia a adotou.
