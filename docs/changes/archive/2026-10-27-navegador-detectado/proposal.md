# Chromium do Playwright detectado antes do baseline

Tarefa 41, autorizada pelo Gilson em 2026-10-27 (GO na thread) a partir dos desvios da retro da change
passkeys do SYND (discovery em `/mnt/project-files/analysis/retro-passkeys-desvios.md`). Release: v1.80.0.

**Mudança deltaless.** Esta mudança não carrega delta em `specs/`. Ela acrescenta uma linha ao relatório
de `capabilities.mjs`; o comportamento dos projetos consumidores não muda.

## Problema

No SYND, o Playwright pediu um build do Chromium que não estava instalado na máquina, e isso só apareceu
quando o pass 2 rodou a suíte de navegador. `capabilities.mjs` respondia `browser: unknown` sempre, com a
razão de que o driver é ferramenta do harness. O build que o teste de navegador lança, porém, é fato de
disco: a revisão está no `browsers.json` do Playwright do projeto, e a pasta no cache dele.

## Escopo

1. **`browser.playwright_chromium`** em `capabilities.mjs`, quando o projeto tem `playwright-core` em
   `node_modules` ou declara Playwright no `package.json` (sem o manifesto onde esta linha lê, como no
   store do pnpm, a resposta é `unknown`, nunca "sem Playwright"): `present` (VERIFIED) quando todo build Chromium que o Playwright instala por padrão
   está no cache; `absent` (VERIFIED) com o nome de cada pasta que falta e o comando
   `npx playwright install chromium`; `unknown` quando o manifesto ou o cache não se lê. Nunca presente
   por suposição.
2. **O cache é achado pelas regras do Playwright**: `PLAYWRIGHT_BROWSERS_PATH` (e `0`, dentro do pacote),
   senão `~/.cache/ms-playwright` (ou `XDG_CACHE_HOME`), `~/Library/Caches/ms-playwright` e
   `%LOCALAPPDATA%\ms-playwright` (ou `~/AppData/Local`); um caminho relativo é lido a partir da raiz do projeto.
3. **Nada roda**: nenhum browser lançado, nenhum código das dependências do projeto executado, nenhuma rede.
4. **Card do Platform Engineer**: com suíte de navegador, ler essa linha antes do baseline e instalar o build
   que falta antes dele, nunca como vermelho do pass 2.
5. **Testes** em `tests/browser-cache.test.mjs`, vistos vermelhos sem o código.
6. A retro de `painel-desempenho` (#112), devida por esta.

## Identidade

- **O build pedido** é `<nome com _>-<revisão>` de cada entrada `chromium` e `chromium-headless-shell` do
  `browsers.json` com `installByDefault` diferente de `false`. Um build de outra revisão é ausente. Uma
  entrada com `revisionOverrides` dá `unknown`: a revisão por plataforma é escolha do Playwright, e
  adivinhá-la daria `absent` para um build que está lá.
- **Em quem confia:** no `browsers.json` do projeto e no cache que o Playwright usa, ambos lidos, nunca
  executados. Uma pasta presente não prova que o binário dentro dela abre.

## Fora do escopo

- Firefox e WebKit, que nenhum incidente pediu.
- O Playwright MCP do harness, que é capacidade declarada pelo adaptador (`adapter.*.browser`).
- O padrão de teste de navegador sem corrida e o D-034, que são disciplina do SYND.

## O que esta mudança deve e não paga

- D-025: a linha lê a pasta, não abre o binário; uma instalação corrompida aparece como `present`, um
  Playwright fora de `node_modules` do projeto (global, store do pnpm, workspace aninhado) dá `unknown`
  ou nada, e um build instalado só com `--only-shell` ou `--no-shell` dá `absent`.
