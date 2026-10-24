# TAP aninhado do Vitest

Tarefa 18, autorizada pelo Gilson em 2026-10-24: o item 6 da análise do custo de verificação do
SYND C3a. Release: v1.56.0.

**Mudança deltaless.** Esta mudança não carrega delta em `specs/`. A saída do `node --test` é lida
como antes; o que muda é que a forma do Vitest deixa de ser recusada.

## Problema

O PR #78 tirou o sufixo `# time=` das linhas-folha. A análise suspeitava que as linhas de grupo
continuavam erradas. Uma saída real do Vitest 5.0.5 (`--reporter=tap`) confirmou que é pior do
que isso: o Vitest imprime o veredito do grupo antes dos filhos, entre chaves
(`not ok 1 - account # time=1.00ms {` ... `}`). O leitor espera o veredito depois dos filhos, como
no `node --test`, e ligava cada grupo ao resultado errado. Com isso, toda execução aninhada do
Vitest era julgada `INFRA_ERROR`, em pass 1, mutação, checks e perfil de entrega. Só o
`--reporter=tap-flat` funcionava.

## Escopo

1. **Retro da tarefa 17** (`mutacoes-em-lote`), devida por esta mudança, coletada com
   `retro.mjs collect 88`.
2. **`parseTap`:** um resultado que termina em `{` anuncia o próximo grupo, mais fundo, e passa a
   ser o resultado pai dele. A chave e o tempo saem do nome. Um resultado que fecha um subteste e
   abre outro ao mesmo tempo é recusado como problema estrutural.
3. **Fixture gravada** de uma execução real do Vitest 5.0.5 (`tests/fixtures/vitest-5.0.5-nested.tap`),
   só com o caminho absoluto trocado. `tests/tap-vitest.test.mjs` cobre a árvore, os três juízes e
   as recusas: nome de grupo, skip, falha, execução cortada e grupo verde com filho vermelho.

## Fora do escopo

Outros reporters do Vitest. `tap-flat` já era lido e dá nomes com o caminho inteiro
(`a.test.mjs > account > name > ...`), que o projeto precisa usar como nome exato.

## O que esta mudança deve e não paga

Nada novo no ledger. O D-021 do SYND (leitura do TAP do Vitest 5) fica pago do lado do plugin,
e o projeto o fecha quando atualizar.
