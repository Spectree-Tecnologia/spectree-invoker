# Checagens julgadas de um relatório único e CI barata no consumidor

Tarefa 13, autorizada pelo Gilson em 2026-10-24: os itens 1 e 2 da análise do custo de verificação
do SYND C3a. Release: v1.51.0.

**Mudança deltaless.** Nenhum comportamento existente do runtime muda e esta mudança não carrega
delta em `specs/`. Um plano com `command` continua válido e é julgado como antes; o que entra é uma
forma nova de check, um comando novo e o template de CI.

## Problema

No SYND C3a o job `tests` levou 30 min, e 28 min 25 s foram um laço que roda o Vitest uma vez por
check, archive incluído. A suíte completa, que contém os mesmos testes, levou 72 s. O laço é do
projeto, mas o plugin o induz: o `verification.json` só oferecia `command` por check. E a regra
"uma suíte, nunca uma execução por Requirement" saiu do núcleo no corte da tarefa 8 (#76), porque o
inventário de `protocol/rules.json` guarda só a frase de abertura em negrito e ela era explicativa.

O template `consumer-ci.yml` rodava em todo push de toda branch, sem cancelar a rodada anterior,
e não mostrava o `SPECTREE_TEST_NAMESPACE` no nome do banco.

## Escopo

1. **Retro da tarefa 12b** (`seguranca-resposta`), devida por esta mudança, coletada com
   `retro.mjs collect 83`.
2. **Check por nome de teste.** Um check traz `command` ou `tests` (nomes exatos e únicos), nunca
   os dois. `verification.mjs checks <plan> <report.tap>` julga todo check com `tests` a partir de
   uma única execução da suíte: cada nome uma vez entre os testes que rodaram, verde, sem `SKIP` ou
   `TODO`; o veredito de um grupo não conta como teste. Relatório incompleto ou com `Bail out!`
   julga tudo `INFRA_ERROR`. Check com `command` sai `NOT_EVALUATED`, e um plano sem nenhum check
   julgável é recusado.
3. **A regra volta ao §7.1** com frase de abertura própria, guardada em `protocol/rules.json`.
   Para caber no teto de 46.080 bytes, o §7 e o §12 perdem redação repetida, sem regra a menos.
4. **`consumer-ci.yml` barato por padrão:** `pull_request` e push só na `main`, `concurrency` com
   `cancel-in-progress`, `SPECTREE_TEST_NAMESPACE` por rodada para o nome do banco, a suíte uma vez
   em TAP e `checks` sobre os planos das changes abertas. Changes arquivadas não ganham passo.
5. `docs/reliability.md` e o exemplo `verification.json` mostram a forma nova;
   `tests/verification-plan.test.mjs` e `tests/reliability-install.test.mjs` travam o julgamento,
   os controles negativos e o formato do template.

## Fora do escopo

Os itens 3 a 8 da análise (documentação e log fora do digest, congelamento antes do pass 2,
mutações em lote, linhas de grupo do Vitest, emenda de caminhos, baseline de uma rodada
existente). Cada um é uma mudança própria, se autorizado. Nada muda no SYND: ele adota a forma nova
ao atualizar o plugin.

## O que esta mudança deve e não paga

- D-013: o gatilho disparou. O núcleo terminou com 44 bytes de folga; a próxima regra nova paga o
  teto ou o corte numa mudança própria.
- R-009: só a regra da suíte única ganhou entrada no inventário. As demais frases explicativas do
  núcleo continuam sem proteção mecânica.
