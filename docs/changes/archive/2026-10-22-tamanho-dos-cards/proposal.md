# Tamanho dos cards

Tarefa 9 do [ciclo de modularização do repositório](../../../ROADMAP.md#ciclo--o-repositório-seguindo-a-própria-arquitetura),
pedida pelo Gilson em 2026-10-22: o mesmo corte de regra e justificativa da tarefa 8, aplicado aos
dois cards mais longos.

**Mudança deltaless.** Nenhum comportamento do runtime muda e esta mudança não carrega delta em
`specs/`. Muda o texto de dois cards, e a prova de que nenhuma regra se perdeu é o inventário
checado por `check-plugin`, mais a suíte existente verde.

## Problema

O card do Solutions Architect tinha 47 KB e o do Platform Engineer 30 KB, renderizados. Cada
despacho desses papéis carrega o card inteiro, e boa parte do texto explicava o porquê de cada
regra, não a regra.

## Escopo

1. `protocol/roles/solutions-architect.md` e `protocol/roles/platform-engineer.md` ficam só com as
   regras. Toda frase de abertura em negrito, todo título, todo modelo em bloco de código e toda
   linha de Guardrails continuam iguais.
2. O texto dos dois cards como estava antes do corte vai para o fim de
   `docs/protocol-rationale.md`, em *Card — Solutions Architect* e *Card — Platform Engineer*.
   Cada card aponta para lá pelo token `RATIONALE_LOCATION`, que o instalador do Codex já copia.
3. `protocol/rules.json` ganha a chave `cards`, com as 116 regras do Architect e as 80 do Platform
   Engineer, lidas dos cards antes do corte, e um teto por card: 34.816 bytes (34 KB) e 22.528
   bytes (22 KB). `check-plugin` falha quando o card que um adaptador entrega perde uma regra, passa
   do teto ou não aponta para a justificativa.
4. `tests/package-integrity.test.mjs` mostra essas recusas acontecendo nos dois harnesses.

## Resultado

| Medida | Antes | Depois |
|---|---|---|
| `agents/solutions-architect.md` | 46.925 bytes | 33.660 bytes |
| `adapters/codex/dist/agents/solutions_architect.toml` | 47.105 bytes | 33.843 bytes |
| `agents/platform-engineer.md` | 29.897 bytes | 21.184 bytes |
| `adapters/codex/dist/agents/platform_engineer.toml` | 30.067 bytes | 21.357 bytes |
| Regras no inventário presentes nos dois harnesses | — | 196 de 196 |

## Fora do escopo

- Os outros quatro cards (Quality Engineer 20 KB, Full Stack Developer 17 KB, TypeSafe Engineer
  15 KB, Integration Engineer 4 KB). Ficam como estão.
- Nenhuma regra nova e nenhuma regra removida.
- Também nesta mudança: arquiva a mudança da tarefa 8 (`tamanho-do-protocolo`, PR #76).
