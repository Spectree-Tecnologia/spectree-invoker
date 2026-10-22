# Tamanho do protocolo

Tarefa 8 do [ciclo de modularização do repositório](../../../ROADMAP.md#ciclo--o-repositório-seguindo-a-própria-arquitetura).
Resolve o D-008 do [ledger](../../../DEFERRED.md), com a decisão do Gilson de 2026-10-19: separar
regra de justificativa, com alvo de 45 KB.

**Mudança deltaless.** Nenhum comportamento do runtime muda e esta mudança não carrega delta em
`specs/`. O que muda é o texto do protocolo, e a prova de que nenhuma regra se perdeu é o
inventário checado por `check-plugin`, mais a suíte existente verde.

## Problema

O `CLAUDE.md` gerado tinha 86 KB e era carregado inteiro em toda sessão do Invoker; o
`SQUAD.md` do Codex, o mesmo tamanho. Boa parte do texto era a história do defeito que produziu
cada regra. A seção 7 sozinha tinha 41 KB.

## Escopo

1. O protocolo em `protocol/` fica só com as regras. A seção 7 foi reorganizada em quatro
   subseções (antes do build, construção, despacho, verificação e fechamento). Cada regra mantém
   a frase de abertura em negrito, e as recusas da seção 11 não mudaram.
2. `docs/protocol-rationale.md` guarda o porquê: o texto das seções como estava antes da
   separação, inteiro, para cada razão ficar ao lado da regra que explica. O protocolo aponta para
   ele pelo token novo `RATIONALE_LOCATION`, e o instalador do Codex o copia para
   `.spectree/squad/docs/`.
3. `protocol/rules.json` é o inventário das 174 regras, lido do protocolo antes da separação: a
   frase de abertura de cada regra e cada linha de recusa. `check-plugin` falha quando um núcleo
   renderizado perde uma delas, passa de 46.080 bytes (45 KB) ou não aponta para a justificativa.
4. `tests/package-integrity.test.mjs` mostra cada uma dessas recusas acontecendo.

## Resultado

| Medida | Antes | Depois |
|---|---|---|
| `CLAUDE.md` | 86.529 bytes | 45.591 bytes |
| `adapters/codex/dist/SQUAD.md` | 86.495 bytes | 45.560 bytes |
| Seção 7 do protocolo | 40.852 bytes | 14.962 bytes |
| Regras no inventário presentes nos dois núcleos | — | 174 de 174 |

## Fora do escopo

- Os cards dos especialistas. O do Solutions Architect tem 47 KB e o do Platform Engineer 30 KB,
  mas são carregados só quando o papel é despachado. Ficam para uma mudança própria, se o
  Gilson quiser.
- Os exemplos "Exploration" e "Dispatch" da seção 13 saíram do protocolo e estão na
  justificativa; não são regras.
- Também nesta mudança: arquiva a mudança da tarefa 7 (`papeis-do-repositorio`, PR #75).
