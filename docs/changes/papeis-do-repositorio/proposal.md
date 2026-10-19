# Papéis deste repositório

Tarefa 7 do [ciclo de modularização do repositório](../../ROADMAP.md#ciclo--o-repositório-seguindo-a-própria-arquitetura).

**Mudança deltaless.** Nenhum comportamento observável muda. Esta mudança não carrega delta em
`specs/`, não edita código de runtime e não muda nenhum teste existente. O critério de saída é a
suíte existente verde, mais o teste novo que trava os papéis.

## Problema

As tarefas 2 a 5 deixaram o runtime com convenções que o código segue de forma consistente, mas
que não estavam escritas em lugar nenhum: como uma recusa é devolvida, o que significa uma
resposta ausente, como um registro em `.spectree/` é gravado, em que fases uma escrita com efeito
externo avança e onde o código mora. Quem edita `scripts/lib/` hoje precisa deduzir isso lendo
vários arquivos, e um módulo novo pode divergir sem que nada perceba.

## Escopo

1. `docs/roles/` com um papel por convenção, cada um apontando para o arquivo que já é o exemplo e
   para o teste que a guarda:
   - `modules-and-facades.md`: módulos, entrada publicada, grafo e o formato de um CLI;
   - `refusals.md`: códigos `E_`, `W_` e `I_`, `refuse()` contra `{ ok: false, code, message }`;
   - `absence-is-unknown.md`: ausência é desconhecido, nunca sucesso;
   - `persistence.md`: os três escritores, `withLock` e a ordem de lock;
   - `operation-phases.md`: as fases `intent` a `done` e a recuperação de cada uma.
2. `tests/roles.test.mjs` falha quando um papel cita um arquivo que não existe mais e quando um
   código em `scripts/lib/` foge do formato de `refusals.md`. Cada guarda primeiro mostra que
   recusa o caso que existe para pegar.
3. `CONTRIBUTING.md` e `docs/architecture.md` apontam para os papéis.

Os papéis estão em inglês, como `docs/architecture.md` e o código que descrevem.

## Fora do escopo

- Corrigir código que diverge de um papel. O único caso encontrado foi a Console, que recusa
  argumentos com `Error` sem código; ele foi registrado como D-011.
- Skills do repositório. Os papéis dizem o quê; um procedimento só vira skill quando se repetir.

## Também nesta mudança

- Arquiva a mudança da tarefa 6 (`suite-mais-rapida`, PR #74).
- Atualiza o D-007 com a decisão do Gilson de 2026-10-19: 43 s é o novo teto da suíte.
