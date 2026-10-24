# Retro pós-merge: o runtime cobra a retro depois do `closed`

Tarefa 11c do [ciclo de modularização do repositório](../../../ROADMAP.md#ciclo--o-repositório-seguindo-a-própria-arquitetura),
autorizada pelo Gilson em 2026-10-24, logo depois do merge da 11b. Release: PR #82 / v1.49.0.

**Sem delta em `specs/`.** Este repositório não tem specs vivos. O comportamento novo do runtime é
provado pelos testes desta mudança, e o resto da suíte segue verde.

## Problema

O protocolo põe a retro depois do `closed`, mas o runtime não sabia disso. O planner respondia
"nada a fazer" para uma change fechada, nada registrava que a retro aconteceu, e a próxima change
abria do mesmo jeito. Nos projetos consumidores, a retro dependia de alguém lembrar.

## Escopo

1. **Evidência `retro.recorded`:** é produzida por `state.mjs run <change> retro.recorded --role invoker -- node <squad>/scripts/retro.mjs check <change> <arquivo>`.
   O `retro.mjs check` recusa um arquivo inexistente (`E_RETRO_MISSING`), um arquivo sem a linha
   `Change: \`<change>\`` ou sem a seção do que foi lido (`E_RETRO_INCOMPLETE`) e um caminho fora do
   projeto.
2. **Planner:** uma change `closed` sem retro registrada responde `record_retro` (código
   `E_RETRO_PENDING`), com a skill, o comando de coleta e o comando de registro. Sem nenhuma change
   aberta, o `state.mjs plan` sem id escolhe a change que deve a retro.
3. **`state.mjs open`:** recusa com `E_RETRO_PENDING` enquanto houver change fechada sem retro.
   Só uma pessoa dispensa, com `--retro-waived "<razão>"`, e a change aberta guarda
   `retro_waiver: { changes, reason }` (o schema da change foi atualizado). Uma retro dispensada
   não volta a ser cobrada.
4. **Documentação:** a skill `squad-closure-retro` e o `docs/workflow.md` descrevem o registro e a
   dispensa. O núcleo do `CLAUDE.md` não muda, porque tem 146 bytes de folga (D-013).

## Fora do escopo

- A retro da 11b viaja no PR #81, da frente de segurança, que entra antes desta.
- As tendências entre retros (`retro.mjs trends`) e a leitura obrigatória do Architect: fatia 11d.
- Este repositório continua sem mudanças estruturadas (D-009), então quem cobra a retro aqui é
  `tests/repo-changes.test.mjs`.

## Compatibilidade

Muda uma coisa para quem já usa: depois de atualizar, o primeiro `state.mjs open` de um projeto
com changes fechadas sem retro é recusado. A saída é registrar as retros ou abrir uma vez com
`--retro-waived "<razão>"`, que cobre todas as changes listadas.
