# Retro pós-merge: fechamento no próprio PR e primeira retro registrada

Tarefa 11 do [ciclo de modularização do repositório](../../../ROADMAP.md#ciclo--o-repositório-seguindo-a-própria-arquitetura),
autorizada pelo Gilson em 2026-10-24, depois do piloto que fez a primeira retro deste repositório
(lote do #58 ao #78). Release: PR #79 / v1.46.0.

**Mudança deltaless.** Nenhum comportamento do runtime muda e esta mudança não carrega delta em
`specs/`. Muda o fluxo de documentos deste repositório e ganha um teste que o trava.

## Problema

1. O protocolo (§7.4) manda preparar o fechamento no candidato: arquivar a pasta e atualizar os
   documentos dentro do PR. Este repositório fazia isso no PR *seguinte*, então a `main` ficava
   com a mudança ativa e a linha do ROADMAP desatualizada entre um merge e o próximo. Foram 12 PRs
   seguidos assim (R-002).
2. A squad skill `squad-closure-retro` existe, mas nenhuma retro tinha sido feita aqui, e o rastro
   que ela lê não existe neste repositório: CI 100% verde e de 1 a 4 commits por PR (R-003).

## Escopo

1. Arquiva a mudança da tarefa 10 (`pass1-superficie`, PR #78) e marca a linha 10 do ROADMAP.
2. **Fechamento no próprio PR, a partir desta mudança:** esta pasta já nasce no archive, e a linha
   11 do ROADMAP já diz "Integrada". O conteúdo é preparado no candidato; o merge é o que o torna
   verdadeiro, e o hash do merge é do recibo, não do documento. `tasks.md` não carrega mais a linha
   "CI verde": a evidência é o próprio PR.
3. `tests/repo-changes.test.mjs` recusa, a partir de v1.46.0, um release sem proposta arquivada
   que o nomeie, uma linha do ROADMAP que diga o contrário da pasta que ela aponta, e uma mudança
   arquivada desde 2026-10-24 sem retro, menos a do próprio release. Cada recusa é vista primeiro
   numa fixture do estado em que o #78 deixou a `main`.
4. `docs/retros/` com as regras, o índice de achados e as duas primeiras retros: o lote do #58 ao
   #78 e a do #78.
5. O template de PR ganha a seção **Atrito** (tentativas, reds locais, o que mudou depois do
   primeiro push) e o item "mudança arquivada e ROADMAP marcados neste PR". `CONTRIBUTING.md`
   aponta para as duas regras.
6. Os achados não pagos entram no ledger: D-012 (R-001, versão e id de teste disputados entre
   branches paralelas) e D-013 (R-004, tetos sem folga).

## Fora do escopo

- Ferramentas da retro: `retro.mjs collect` e `trends`, a evidência `retro.recorded`, o planner
  apontando a retro depois do `closed` e a recusa `E_RETRO_PENDING`. São as próximas entregas,
  cada uma com a sua autorização.
- A skill `squad-closure-retro` e os cards não mudam. A retro continua registrando no `DEFERRED.md`
  o que não foi pago; `docs/retros/` é o registro da retro inteira, que a skill não tinha onde pôr.
- R-001 e R-004 não são corrigidos aqui.

## O que esta mudança deve e não paga

D-012 e D-013, registrados com dono e gatilho. O longo prazo de R-003 continua sendo o D-009.
