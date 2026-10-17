# P4 — estado da verificação

## Preparação contra main atual — candidata 1.21.0

Após solicitação do Founder, `origin/main` em `ac7fd7d` foi incorporada por
merge à branch `codex/presence-p4-delegation`, sem rebase, force-push ou merge
na main. A integração inclui PRs #49–#53; o #53 já estava integrado com 1.19.0.
Esse primeiro merge de base não teve conflitos textuais. Após o avanço da main
para `5d9f7c4` / 1.20.0 pelo PR #54, um segundo merge foi concluído em `746c852`.
Os únicos conflitos foram os campos de versão em `.claude-plugin/plugin.json`,
`package.json` e `package-lock.json`: preservada a candidata 1.21.0 e todos os
demais conteúdos da main. Nenhum arquivo gerado foi editado à mão: `npm run build`
confirmou que os artefatos já correspondiam a `protocol/`, inclusive os do #54.

Versão candidata **1.21.0** alinhada em manifesto, pacote, lockfile e
`clientInfo` do Presence. Durante a conferência para publicação, o PR #54 foi
encontrado aberto com 1.20.0, tornando 1.21.0 a próxima minor livre. Ele depois
entrou na main; base e versões serão consultadas novamente antes do push.

Auditoria da fronteira: **56 módulos de runtime**, excluídos apenas os quatro
entrypoints locais `console.mjs`, `presence.mjs`, `presence-canary.mjs` e
`presence-voice-canary.mjs`. Nenhum import relativo de runtime aponta para
`presence/` ou libs `presence-*`/`console-*`. As 37 entradas nomeadas de
`RUNTIME_LIBS`, incluindo `scope-policy.mjs` da main, foram preservadas.
**Nenhuma lib adicionada:** `presence-roles.mjs` e `presence-squad.mjs` pertencem
à UI local e não são dependências do runtime instalado no consumidor.

`npm ci` concluído com sucesso: 2 pacotes instalados, zero vulnerabilidades.
Execução integrada em 1.20.0, após `npm ci`: **506 testes, 506 aprovados,
zero falhas, cancelamentos ou skips**, em **409.922,7585 ms** (aproximadamente
6 min 50 s). Drift e integridade do plugin também passaram. O teste **5e2**
passou, assim como as regressões de Architect modelador, catálogo de convenções
e política de autonomia da main. Os **498/498 anteriores são históricos da
base antiga e não validam esta candidata**.

Após identificar a reserva concorrente da 1.20.0 no PR #54, a candidata foi
elevada para 1.21.0. A revalidação limpa dessa versão sobre `ac7fd7d` passou:
**506/506 testes**, zero falhas ou skips, em **395.014,857 ms**. Entretanto, na
conferência final o PR #54 já havia avançado a main para `5d9f7c4` / 1.20.0.
O push foi bloqueado antes de ocorrer. A nova base foi incorporada em `746c852`;
a revalidação limpa sobre `5d9f7c4` foi concluída: **507 testes, 507 aprovados,
zero falhas, cancelamentos ou skips**, em **443.415,1809 ms** (aproximadamente
7 min 23 s). `npm ci`, `npm run build`, drift e integridade também passaram.
O teste 5e2 e as regressões do PR #54 passaram nesta última execução.

`git fetch origin` após a suíte confirmou novamente `5d9f7c4` / 1.20.0, sem
outro PR aberto ou tag 1.21.0 reservando a candidata. A auditoria da fronteira
foi repetida: 56 módulos, zero imports de UI pelo runtime. Comparação dos três
manifestos com a main confirmou igualdade dos demais campos, exceto versões.
Depois da suíte, apenas registros documentais foram atualizados; código, testes,
versões e dependências permaneceram iguais. Somente esta última execução é o
check final do PR. Nenhuma API paga ou projeto consumidor real foi usado.
Publicação por push da branch e PR para main, sem autorização inferida de merge.

## Estado atual — P4.1 implementada, sem merge

Após autorização do Founder, implementação em `codex/presence-p4-delegation`,
partindo do planejamento corrigido em `1fd3fdf`. A implementação inicial foi
validada em 1.16.0; a preparação atual é a candidata 1.21.0 descrita acima.

- Registro dos seis papéis e perfis fixos em `presence-roles.mjs`, incluindo
  TypeSafe condicional, sem aceitar prompts ou capacidades do navegador.
- Coordenador `presence-squad.mjs`: sessão proprietária por delegação, IDs de
  instância, resultados validados, eventos ordenados, deduplicação, limites,
  timeout, lease e cancelamento antes/depois do ACK.
- `presence-session.mjs` preserva o perfil Invoker como default e permite apenas
  papéis registrados; correlação privada de thread/turno não entra na API do squad.
- API textual autenticada e local com `--codex --squad`; domínio de requisições
  compartilhado com a API Invoker e exclusão de trabalho concorrente. Modo squad
  recusa áudio; `delegar_subagente` tem descritor e executor genéricos no backend.
- Guia de uso em [presence-squad.md](../../presence-squad.md) e delta do único
  módulo alterado em [specs/presence/spec.md](specs/presence/spec.md).

### Evidência executada

Os testes usam **RPC Codex simulado**, passando pelo gerenciador real de sessão,
e HTTP real em loopback. Isso comprova os contratos e a coordenação local, não
uma consulta inferida por modelos reais ou o aceite audiovisual do Founder.

Comando focado:

```text
node --test tests/presence-squad.test.mjs tests/presence-session.test.mjs tests/presence-realtime.test.mjs
```

Resultado: **59/59 aprovados**, zero skips ou falhas. Depois foi acrescentado um
teste de CLI que recusa mistura com áudio; a regressão completa inclui esse teste.
A primeira execução restrita encontrou `EACCES` no loopback, inclusive no teste
HTTP já existente da P2. A repetição com acesso local permitido passou; não houve
chamada a API paga nem mudança de expectativa para contornar o bloqueio.

Regressão completa **da base antiga**, `npm run check`: **498/498 aprovados**, zero falhas,
cancelamentos ou skips, em **782.390,8386 ms** (aproximadamente 13 min 2 s).
`check:drift` e `check:plugin` também aprovados. A suíte inclui os **29 testes
novos P4.1**, incluindo a CLI. Depois da execução, somente os registros de
verificação e roadmap foram atualizados; o código e os testes permaneceram iguais.
Os 25 links locais dos seis documentos de planejamento/uso foram verificados,
sem destino ausente; `git diff --cached --check` também passou.

| Contrato P4.1 | Cobertura discriminante em `tests/presence-squad.test.mjs` |
|---|---|
| Registro e roteamento | A1/A13 parametrizados pelos seis papéis; TypeSafe elegível e inelegível. |
| Entrada e retorno limitados | A3, A8: campos/papéis desconhecidos, contexto longo, JSON inválido, campos extras e fala excessiva. |
| Isolamento | Thread efêmera, sandbox sem rede, MCP desativado, diretório temporário e tentativa de ferramenta recusada. |
| Idempotência | A2: duplicata antes/depois da conclusão, conflito e recusa de trabalho concorrente. |
| Autoria e projeção | A14/A15: Developer → Quality → Developer, IDs distintos, eventos monotônicos e ausência de raciocínio/IDs privados. |
| Cancelamento | A4/A7/A12: antes do ACK, ACK sem terminal, conexão pendente, timeout, lease e troca de sessão. |
| Serviço local opt-in | Token, origem, corpo restrito, request ID cruzando endpoints, bloqueio de envio concorrente e CLI sem áudio. |

### Limites restantes

P4.1 cobre o backend textual dos cenários A1–A4, A7–A9, A12–A15. Aspectos
de reprodução, ressincronização visual e hangup da jornada audiovisual continuam
dependendo de P4.2–P4.3. Nenhum personagem novo é anunciado na tela atual e a
ferramenta de especialistas ainda não é anunciada ao modelo Realtime.

Não houve ensaio real dos novos perfis Codex, transcrição, síntese ou conversa
Realtime nesta etapa. Nenhum teste ou escrita em `spectree-workspace` ou
`sindy-agent`. Reservas anteriores preservadas; saldo conservador conhecido
US$ 0,70 do teto US$ 6, sem consulta ao faturamento.

Recomendação atual: revisar e integrar a P4.1 como backend textual independente;
seguir para P4.2 com identidade por instância e arbitragem de reprodução. Esta
recomendação não é autorização de merge nem aceite de áudio real dos subagentes.

Referência oficial consultada em 2026-10-17:
[ciclo de sessão e interrupção do Codex app-server](https://learn.chatgpt.com/docs/app-server).

## Histórico — escopo do planejamento

2026-10-17: planejamento após GO do Founder, em `codex/presence-p4-planning`,
base `8c7b099` / v1.16.0. Não houve implementação de P4 ou ensaio pago nesta etapa.
Nenhuma escrita ou teste em projetos consumidores.

## Histórico — evidência de base e inspeção

- P3-R integrada pelo [PR #48](https://github.com/Spectree-Tecnologia/spectree-invoker/pull/48).
  [Workflow do merge](https://github.com/Spectree-Tecnologia/spectree-invoker/actions/runs/38998524893)
  aprovado, tag v1.16.0 no commit de base; suíte Windows do candidato: 469/469.
  Esses resultados pertencem à P3-R, não validam funcionalidades P4.
- `presence/state.mjs` já contém Architect azul e eventos de demonstração;
  `renderer-core.mjs` suporta personagem secundário e energia por falante.
- `presence/live.mjs` fixa `specialist: null`; `presence/realtime.mjs` atribui
  saída ao Invoker. Não há especialista vivo na interface atual.
- `presence-session.mjs` fixa perfil Invoker e proíbe especialistas/ferramentas;
  P4 exige perfil e sessão próprios, sem remover as proteções existentes.
- `presence-realtime.mjs` tem somente `consultar_codex`; conclusão e cancelamento
  são correlacionados à sessão proprietária. Preservar essa garantia no novo fluxo.
- `presence-voice.mjs` já usa síntese separada, mas fixa voz `marin`, aguarda o
  arquivo completo e mantém orçamento próprio. Não comprova arbitragem de dois
  falantes, streaming da síntese ou contabilidade compartilhada com Realtime.

## Histórico — verificação documental do planejamento

Proposta, tarefas e roadmap são os únicos artefatos desta mudança. Os **17 links
locais** dos quatro documentos apontam para arquivos existentes. Na abertura da
branch, HEAD e tag v1.16.0 foram consultados e resolviam para
`8c7b0999cb233cab0ffec15b71d19386b14813f7`.
Nenhum código do runtime mudou. `git diff --check` aprovado na revisão documental;
repetir sobre o conteúdo staged antes do commit. Não foi repetida a suíte completa
para documentos: nenhuma nova evidência de execução P4 pode ser inferida disso.

## Histórico — pendências antes da implementação

Todos os cenários A1–A15 e incrementos P4.1–P4.3 estão pendentes de implementação
e evidência. Não existe aceite de timbre `cedar` em português, fila de áudio real,
delegação dos subagentes ou desempenho P4. A consulta à documentação oficial verificou
possibilidades da API, sem testar compatibilidade desta conta ou do transporte.

Saldo conservador conhecido: US$ 0,70 do teto US$ 6, após US$ 5,30 reservados;
não é extrato do provedor. Nenhuma reserva foi reiniciada ou ampliada.

## Correção de escopo pelo Founder — 2026-10-17

O Founder esclareceu que a delegação se aplica a qualquer subagente, não apenas
ao Architect. Proposta, tarefas e roadmap foram corrigidos: ferramenta genérica,
registro dos seis papéis canônicos de `schemas/common.json`, instâncias próprias
e voz/apresentação atribuídas por participante. Architect permanece somente como
primeiro exemplo e ensaio pago; os demais papéis não ficam para outro ciclo.

A13–A15 exigem cobertura dos papéis, elegibilidade e isolamento entre instâncias.
Isso é planejamento corrigido, sem nova implementação ou evidência de execução.
Os seis IDs da tabela foram conferidos contra `schemas/common.json` e os seis
arquivos de perfil existem em `protocol/roles/`. Links locais e whitespace foram
verificados novamente após a correção.

Recomendação do planejamento: implementar P4.1 com o registro completo e provar
autoria, roteamento e cancelamento por instância antes de integrar as vozes.
