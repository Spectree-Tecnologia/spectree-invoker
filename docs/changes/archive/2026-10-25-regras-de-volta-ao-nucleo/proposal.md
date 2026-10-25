# Regras do #76 de volta ao núcleo

Tarefa 22, autorizada pelo Gilson em 2026-10-25: o D-017. Release: v1.61.0.

**Mudança deltaless.** Esta mudança não carrega delta em `specs/`. Ela devolve ao protocolo frases
que já vinculavam antes do #76 e endurece o `check-plugin`; o runtime não muda.

## Problema

O #76 separou regra de justificativa e levou o núcleo de 86 KB para 45 KB. O inventário que devia
provar que nenhuma regra se perdeu (`protocol/rules.json`) guarda só a frase de abertura de cada
regra, então um corpo esvaziado passava. Frases que mandam em agente foram para
`docs/protocol-rationale.md`, que se declara não vinculante. A revisão independente do #92 achou o
caso; a regra da suíte única (R-009) já tinha escapado assim.

## Escopo

1. **Retro da tarefa 11d** (`retro-tendencias`), devida por esta mudança, coletada com
   `retro.mjs collect 93`.
2. **As frases perdidas voltam ao §7**, compactas. Primeiro 11 trechos nos parágrafos que o revisor
   do #92 apontou (adoção arquitetural, perfil de entrega, plano de verificação, TypeSafe, executor,
   execução resiliente, diagnóstico, adoção operacional, fronteiras de operação, reconciliação,
   aprovação ambígua); depois as 11 frases que a classificação abaixo achou perdidas e que mandam em
   agente, em 9 trechos; e por fim 2 frases sem marca normativa que a revisão desta mudança achou
   (o fluxo exigido quando o significado de um campo muda, e o slot perdido duas vezes no bootstrap).
3. **Classificação das 258 frases** que o #76 tirou do núcleo, por um revisor em contexto limpo
   contra o `CLAUDE.md` já com o item 2: 206 mantidas (reescritas), 34 só justificativa, 18 perdidas.
   Das 18, 11 voltaram, uma já está na skill `squad-closure-retro` (como cada tipo de achado da retro
   é encaminhado) e 6 descrevem o runtime de fechamento, não uma ação de agente, e saem do núcleo
   nomeadas aqui:
   - "`unchanged` writes nothing at all."
   - "Nothing is reported as prepared until the projection, the snapshot, the durable pointer and the
     reported digest all agree."
   - "Retirement is DURABLE: it lives in the closure control, not in the manifest…"
   - "And it is one shared rule, read by the preparation, the gates, `resume` and the confirmation alike…"
   - "Each recorded run is identified too — workflow, id, attempt, conclusion…"
   - "`resume` reports the phase and the recovery, and the gates refuse to authorise over a set
     nobody finished applying."
   Elas ficam no código de `scripts/lib/closure/` e nos testes de fechamento; não foram reconferidas
   uma a uma nesta mudança.
4. **`check-plugin` lista cada frase normativa do núcleo** em `core_normative`
   (`protocol/rules.json`): a que some sem sair da lista é recusada, e a nova que não está nela
   também. `node scripts/check-plugin.mjs --write-normative` reescreve a lista, então tirar uma frase
   vira uma linha visível no diff. O `REVIEW.md` pede que a proposta nomeie cada linha que sai.
5. **Teto do núcleo de 46.080 para 49.152 bytes.** O núcleo fica com 48.996. Cortar 3 KB de
   redação "repetida" sem perder regra é o corte que causou o D-017. O Founder escolheu subir o teto
   em 2026-10-25, no cartão de decisão da thread.
6. **D-018 e D-019 registrados**, só como gatilho: hook que barra escrita fora dos caminhos do papel,
   e lint de memória (`DOMAIN.md`/`DECISIONS.md` contraditos pelo código).

## Achado recorrente da área

R-004 (`automated-checks · protocol · teto-sem-folga`, D-013): esta é a terceira mudança cujo escopo
o teto do núcleo decide. Não é pago aqui: o D-013 pede aviso de folga abaixo de 2% no
`check-plugin` e orçamento de bytes declarado na proposta; este item declara o seu (+2.960).

## Fora do escopo

- O mesmo exame nos cards do Solutions Architect e do Platform Engineer, que passaram pela mesma
  separação no #77; `core_normative` cobre só o núcleo.
- Uma varredura completa das frases sem marca normativa. A classificação partiu das frases com
  marca; uma busca por `requires`, `always`, `every`, `each` e `SHALL` nas que não tinham marca achou
  34, das quais 2 perdidas, que voltaram. Uma regra escrita sem nenhuma dessas palavras pode ainda
  estar só na justificativa.
- Mudança de comportamento do runtime, D-016 (integração por risco) e construir D-018 ou D-019.

## O que esta mudança deve e não paga

D-013 segue aberto, com o teto novo registrado. D-018 e D-019 registrados e não pagos.
