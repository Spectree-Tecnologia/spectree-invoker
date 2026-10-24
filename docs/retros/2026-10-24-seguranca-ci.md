# Retro — seguranca-ci (#81, v1.48.0)

Change: `seguranca-ci`

Escrita em 2026-10-24, depois do merge `afc03fe`, a partir de `retro.mjs collect 81 --apply`
(`.spectree/retros/seguranca-ci.signals.json`), na mudança seguinte (11c).

## O que foi lido

O registro da coleta: 1 commit, 1 run de CI verde, 54 minutos aberto, nenhum comentário, seção
Atrito presente e o release v1.48.0 nomeado pela proposta que o próprio merge arquivou. Nenhuma
assinatura conhecida casou. Também o efeito do piso novo do Node numa sessão em nuvem, observado ao
trazer a `main` para a 11c.

## Achados

- **R-008 · 2 · acesso a informação** · `information-access · ambiente · node-abaixo-do-piso` · a
  sessão em nuvem que fez a 11c roda Node 22.22.0, e com `engine-strict` o `npm ci` agora recusa
  (`notsup`, exige `^22.23.4`). A suíte só rodou porque o `node_modules` já existia; uma sessão nova
  não instala as dependências do Presence · o ambiente das sessões precisa do Node no piso (setup
  script ou imagem) · owner: Founder (configuração do ambiente). O piso em si está certo e fica.
- **R-001 · segunda forma** · o Atrito do #81 registra que o Dependabot ficou de fora porque os PRs
  dele não sobem a versão e o job `tag` falharia. É o mesmo identificador sequencial reservado pelo
  PR, agora bloqueando automação · reforça o [D-012](../DEFERRED.md); a versão calculada no merge
  resolve os dois.
- **R-007 · 3 · método do squad** · `squad · thread · pedido-de-merge-atrasado` · no período paralelo,
  o turno que abriu o #80 foi cortado por erro de API e o pedido de merge saiu cerca de 80 minutos
  depois do CI verde · fora do projeto, é o harness da thread · owner: squad (registrado).

## O que funcionou

Duas frentes em paralelo reservaram versões diferentes (1.48.0 e 1.49.0) com a coordenação antes do
corte, e o único conflito ao trazer a `main` foi o número da versão, resolvido mantendo 1.49.0.
