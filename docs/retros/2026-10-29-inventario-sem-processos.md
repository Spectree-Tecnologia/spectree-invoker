# Retro — inventario-sem-processos (#120, v1.86.0)

Change: `inventario-sem-processos`

Escrita em 2026-10-29, depois do merge `a9cc792`, a partir de `retro.mjs collect 120 --apply`
(`.spectree/retros/inventario-sem-processos.signals.json`), na mudança seguinte (48).

## O que foi lido

O registro da coleta:
- dois commits; o segundo (`2d9e766`) deixou o pathspec como única exclusão do inventário, para o
  teste de escopo pegar a perda dele;
- CI verde no único head;
- nenhum comentário;
- a seção Atrito presente.

Nenhuma assinatura conhecida casou.

## Achados

- **R-001 · identificador disputado** · `tool-economy · release · identificador-sequencial-disputado`
  · o #120 e o #119 abriram ao mesmo tempo como tarefa 47 e v1.86.0. O #119, que mergeou depois,
  renumerou para 48 e v1.87.0 e trocou a retro devida. Décima oitava ocorrência, [D-012](../DEFERRED.md).
- **R-019 · coleta sem `gh`** · `information-access · retro · coleta-sem-gh` · nesta sessão o `gh`
  estava autenticado e `retro.mjs collect` rodou. A falta é de ambiente, não do script. Segunda
  observação.

## O que funcionou

As duas threads combinaram a versão e a retro devida antes do merge, e o conflito ficou só nos
arquivos de registro.
