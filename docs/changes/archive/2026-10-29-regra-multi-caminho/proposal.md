# Regra que atravessa vários caminhos ganha Requirement próprio

Tarefa 50, autorizada pelo Gilson em 2026-10-29 a partir da retro do SYND (triagem em
`/mnt/project-files/analysis/retro-synd-executor-cota.md`, item 2). Última de três mudanças em série.
Release: v1.89.0.

**Mudança deltaless.** Esta mudança não carrega delta em `specs/`. Ela muda só o card do Solutions
Architect; o runtime do squad não muda.

## Problema

No SYND, os defeitos D1 e D2 escaparam da especificação. A regra "vivo até qualquer confirmação" valia
em vários caminhos, mas não tinha um Requirement próprio: cada caminho a repetia ou não, e os que não
repetiam ficaram sem teste.

## Escopo

1. **Regra no card do Architect**, na seção do delta, ao lado das regras de redação: uma regra que vale
   em vários caminhos tem um `Requirement` próprio, com um `Scenario` por caminho. A frase entra no
   inventário do card em `protocol/rules.json`, para o `check-plugin` recusar a perda dela.
2. **O porquê e o incidente** vão para `docs/protocol-rationale.md`, na mesma seção.
3. **Espaço no card.** O card do Codex estava a 16 bytes do teto (R-004). Para caber sem subir o teto,
   três trechos ficam mais curtos, sem perder regra:
   - a descrição do que a skill `squad-task-slicing` faz fica só com as fatias por `Scenario` e o
     expand–contract;
   - a descrição de candidato de `squad-deepening-scan`, que a própria skill já traz, sai do card;
   - "not your memory of it" vira "never your memory".
4. A retro de `retro-synd-guardas` (#121), devida por esta.

## Fora do escopo

- A mesma regra no card do Quality Engineer: o pass 1 já mapeia um teste por `Scenario`, e a regra
  cria os `Scenario`s.
- Subir o teto do card: segue devido ao R-004 numa mudança própria.

## O que esta mudança deve e não paga

- O card do Codex fica a 51 bytes do teto. A próxima regra no Architect precisa de compactação ou da
  mudança própria do R-004.
