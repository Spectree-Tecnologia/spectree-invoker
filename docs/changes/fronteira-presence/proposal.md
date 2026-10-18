# Fronteira do Presence e `bench/` sem `tests/`

Tarefa 3 do [ciclo de modularização do repositório](../../ROADMAP.md#ciclo--o-repositório-seguindo-a-própria-arquitetura).
Fecha, em código, o D-002 e o D-003 do [ledger](../../DEFERRED.md).

**Mudança deltaless.** Nenhum comportamento observável do runtime, do Presence ou da Console
muda. Esta mudança não carrega delta em `specs/`. O critério de saída é a suíte existente verde,
sem expectativa enfraquecida, mais o teste de fronteira novo.

## Problema

O Presence morava dentro do runtime de governança. `three` e `ws` eram dependências do
`package.json` raiz, embora só o Presence as use. As sete bibliotecas `scripts/lib/presence-*`
ficavam ao lado do runtime, e uma delas importava código de browser (`presence/voice-format.mjs`).
O servidor do Presence importava `console-server.mjs` para servir os próprios arquivos, e o modo
demonstração do Presence era uma opção da Console. Nada impedia o runtime de passar a importar
qualquer um deles.

O `bench/delivery.mjs` importava `tests/helpers.mjs`. Os helpers de fixture viraram API
compartilhada sem que ninguém declarasse isso.

## Escopo

1. `presence/` vira o workspace npm `@spectree/presence`, com `three` e `ws` no próprio
   `package.json`. O `package.json` raiz fica sem dependências e declara `workspaces`.
2. As bibliotecas de servidor saem de `scripts/lib/presence-*.mjs` para `presence/server/`, sem
   o prefixo: `server`, `session`, `rpc`, `roles`, `squad`, `voice`, `realtime`. A única
   dependência delas no runtime é `scripts/lib/launch.mjs`.
3. `presenceAssets` sai de `console-server.mjs` para `presence/server/assets.mjs`. O renderer é
   resolvido como dependência do pacote (`import.meta.resolve('three')`), e não por um caminho
   fixo até o `node_modules` raiz.
4. O modo demonstração sai da Console para `presence/server/demo.mjs` (`startPresenceDemo`), com
   os mesmos cabeçalhos, a mesma checagem de origem e a mesma recusa de abrir projetos. A Console
   perde a opção `presence`.
5. Os helpers que o `bench/` usa saem de `tests/helpers.mjs` para `support/fixtures.mjs`. O
   `tests/helpers.mjs` os reexporta, então nenhum teste muda de import.
6. `tests/app-boundaries.test.mjs` falha se o runtime importar `presence/`, `presence-*`,
   `console-*`, `ws` ou `three`; se o Presence importar a Console; se o `bench/` importar
   `tests/`; ou se o `package.json` raiz voltar a ter dependências. Cada guarda é mostrada
   rejeitando a forma antiga antes de valer.

## Decisões

- **Workspace no mesmo repositório, e não um pacote separado.** O Presence continua sendo
  instalado por `npm ci` na raiz e iniciado por `npm run presence`. O que muda é quem declara as
  dependências.
- **Os pontos de entrada ficam em `scripts/`.** `scripts/presence.mjs` e os dois canários
  continuam onde a documentação e os hábitos os procuram. Eles são entradas da aplicação, e o
  teste de fronteira os trata assim.
- **`support/` é a casa neutra das fixtures.** Os testes e o benchmark importam dela, e nenhum
  dos dois importa o outro.
- **A Console fica em `scripts/lib/console-*`.** Ela não tem dependências próprias, e a fronteira
  que importa é a mesma: o runtime não a importa. Mover a Console de lugar entra na tarefa 4.

## Ajustes em testes, e por quê

- `tests/presence.test.mjs` passa a subir a demonstração por `startPresenceDemo()`, e não por
  `startConsole({ presence: true })`. As asserções de segurança são as mesmas. As duas recusas de
  abrir projetos agora exigem a mensagem de recusa, o que é mais estrito do que antes.
- O mesmo teste lê a versão fixada do `three` em `presence/package.json`, que é onde ela está
  agora. O lockfile e a integridade são conferidos como antes.
- Os imports dos testes do Presence e das fixtures de browser apontam para `presence/server/`.

## Ausências declaradas

- O instalador da Console copia `scripts/lib/` inteiro e, por isso, levava as bibliotecas do
  Presence junto. Agora não leva mais, porque elas saíram de lá. A Console não as usava.
- `tests/presence-lifecycle.test.mjs` importa `three` pela resolução da raiz. É um teste do
  Presence, e a suíte não é um pacote.
- O D-002 e o D-003 continuam abertos no ledger, porque fechar exige evidência observada (D-009).

## Critério de saída

- `tests/app-boundaries.test.mjs` verde aqui e com 4 de 5 testes vermelhos na base `463010d`.
- `build.mjs --check`, `check-plugin.mjs`, `delivery.mjs ledger` e a suíte completa verdes.
- `npm run presence -- --help` e a demonstração respondem como antes.
