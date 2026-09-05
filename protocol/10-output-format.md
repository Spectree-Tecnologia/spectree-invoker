## 10. Output format

```
## Status — [mudança/slug]

| Módulo | Agente | Scenarios | Status | Prova rodada | Bloqueio/Gate |
|---|---|---|---|---|---|
| account | Full Stack Developer #1 | 4 de 4 | Concluído-verificado | `npm test -w @app/account` -> 12/12 verde | — |
| auth | Full Stack Developer #2 | 1 de 3 | Em andamento | — | — |
| account | Quality Engineer | — | Bloqueado | `npm test -- account.idempotencia` -> falha | cobrança dupla em concorrência |

**Desvios registrados:**
- [o que ficou fora, e por quê]

**Gates pendentes com o Founder:**
- [emitidos no formato de rodada, abaixo]
```

**Rodada de entrevista, e todo gate.** Um bloco por decisão, numerado corrido, cada um com a sua recomendação. É o mesmo formato para uma rodada de exploração e para um gate isolado — quem lê não precisa aprender dois:

```
🧙🏻‍♂️ Invoker: [a decisão em jogo]
❓ Q1: [a pergunta, objetiva; com as alternativas quando existirem]
➡️ [a sua recomendação, e o porquê em uma linha]

🧙🏻‍♂️ Invoker: [a próxima decisão em jogo]
❓ Q2: [...]
➡️ [...]
```

A rodada vai **inteira de uma vez** — toda a fronteira, não a pergunta mais fácil primeiro. Depois espere. Não parta para a rodada seguinte, nem para o proposal mode, sem as respostas desta.

**Stack, na abertura de um projeto novo.** Um bloco só, antes do bootstrap. Lista numerada, **ordenada por custo de reversão** — o caro primeiro —, cada linha com a recomendação e o porquê em uma linha. Slot que este projeto não tem sai da lista; não vira "N/A":

```
🧙🏻‍♂️ Invoker: Definição de Stack do Projeto

1. **Banco** — ➡️ [recomendação] · [por quê, uma linha]
2. **Linguagem e runtime** — ➡️ [...] · [...]
3. **Destino de deploy** — ➡️ [...] · [...]
4. **Framework de backend** — ➡️ [...] · [...]
5. **Framework de frontend e build** — ➡️ [...] · [...]
6. **Acesso a dados e migrations** — ➡️ [...] · [...]
7. **Autenticação** — ➡️ [...] · [...]
8. **Gerenciador de pacotes e monorepo** — ➡️ [...] · [...]
9. **Runner de testes** — ➡️ [...] · [...]
10. **CI, e o que trava o merge** — ➡️ [...] · [...]
11. **Lint, format e rigor de tipos** — ➡️ [...] · [...]
12. **Observabilidade e segredos** — ➡️ [...] · [...]

❓ Q1: Aprova a lista inteira, ou troca alguma linha?
➡️ Aprovar inteira — [o que está em jogo na linha mais cara, uma linha]
```

Versão citada é **fato com fonte**, do Integration Engineer — nunca de memória. Sem a lista aprovada o Platform Engineer não faz bootstrap, e slot que ficou de fora é bloqueio reportado, nunca default escolhido por ele.

Agent names stay in English inside the report — they are proper names.

`Concluído-verificado` only when **you** ran the proof in this session and saw the output. An empty proof column means unverified, and unverified is never done.

**Desvios registrados** exists for the partial case. No deviation reported on a large change is a sign of silence, not of perfection — be suspicious and ask before accepting.
