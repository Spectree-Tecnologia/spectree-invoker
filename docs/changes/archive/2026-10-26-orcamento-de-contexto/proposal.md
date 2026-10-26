# Orçamento de contexto: menos chamadas por missão

Tarefa 37, autorizada pelo Gilson em 2026-10-26 a partir da discovery de custo de tokens dos subagentes
(`/mnt/project-files/analysis/custo-tokens-subagentes.md`). Release: v1.76.0.

**Mudança deltaless.** Esta mudança não carrega delta em `specs/`. Ela muda duas regras dos cards do
squad; o comportamento dos projetos consumidores não muda.

## Problema

Na change passkeys do SYND (C3b), a cadeia de subagentes gastou cerca de 33M tokens, 95% em cache
read. Duas missões somaram 24M: o pass 1 do Quality Engineer (80 chamadas, 68 delas uma execução de
teste cada, contexto até 282k) e o proposal do Architect (39 chamadas, 44 arquivos lidos contra uma
leitura obrigatória de 3 a 6, contexto até 338k). Cada chamada reenvia o contexto inteiro, então o
custo cresce com o quadrado das chamadas. Os arquivos do squad pesaram pouco: o card foi cerca de 5%
do total e o `protocol-rationale.md` não foi lido.

## Escopo

1. **Card do Architect:** no modo proposal, a leitura obrigatória do despacho é teto; fora dela, e fora da
   spec viva, busca e leitura por offset. A regra entra no inventário dos cards
   (`protocol/rules.json`), e o `check-plugin` recusa o card que a perder.
2. **Card do Quality Engineer:** o pass 1 escreve os testes de um Requirement, ou do delta inteiro,
   antes de rodar, e roda numa invocação só da suíte; nunca uma invocação por teste. Uma rodada que
   caiu roda de novo só os testes que não alcançou, e o registro do pass 1 segue numa rodada só.
3. **O porquê** em `docs/protocol-rationale.md`, com os números do C3b.
4. **Teste** `21d14` em `tests/acceptance-regressions.test.mjs`, visto vermelho sem os cards gerados.
5. A retro de `despacho-pass2` (#108), devida por esta.

As duas regras cortam chamadas e também tempo de relógio: menos leituras e menos execuções em série.

## Fora do escopo

- **Segmentar uma missão longa** (teto de contexto ou de chamadas, checkpoint e novo despacho em
  contexto zerado): cada segmento repaga o prefixo e a leitura obrigatória, em sequência, e pode deixar
  o pipeline mais lento. O Founder não aplica o que deixe o pipeline mais lento. Fica no D-024.
- **Teto de tempo cobrado pelo runtime** (`timeout_seconds` do despacho, relatório parcial do QE),
  vindo da thread do pass 2: depende da mesma segmentação; fica no D-024.
- A regra no núcleo (§7.3): o núcleo segue a 58 bytes do teto (R-004, D-013).

## O que esta mudança deve e não paga

- D-024: nenhum teto por missão; uma missão que siga acima de ~30 chamadas depois destas duas regras
  continua cara.
- O card do Architect, no Codex, fica a 16 bytes do teto (R-004).
