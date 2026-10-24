# Documentação e log não invalidam a medição do código

Tarefa 15, autorizada pelo Gilson em 2026-10-24: o item 3 da análise do custo de verificação do
SYND C3a. Release: v1.53.0.

**Mudança deltaless.** Esta mudança não carrega delta em `specs/`. O digest de conteúdo continua o
mesmo, então nenhuma evidência já registrada muda de significado; o que entra é uma forma nova de
uma evidência continuar válida.

## Problema

No SYND C3a, uma linha no `docs/DEFERRED.md`, um ajuste no `README.md` e cada ação registrada no
`.log/platform.log` mudaram o digest do candidato. Cada uma obrigou a rodar de novo a suíte e o
pass 2, embora o código medido fosse o mesmo. O digest de conteúdo exclui só `.spectree/` e
`docs/changes/`.

## Escopo

1. **Retro da tarefa 14** (`seguranca-piso-consumidor`), devida por esta mudança, coletada com
   `retro.mjs collect 85`.
2. **`code_fingerprint`:** `state.mjs run` passa a gravar, ao lado do `fingerprint`, o digest do
   mesmo conteúdo sem os caminhos neutros, e a lista sob a qual foi calculado (`neutral_paths`).
3. **Evidência levada adiante:** um gate que pede evidência atual aceita uma execução cujo
   `code_fingerprint` é igual ao de agora, sob a mesma lista. Ele avisa `carried forward` com os ids.
   Uma execução no conteúdo exato tem precedência, então um vermelho atual vence um verde levado
   adiante. A confirmação pós-merge aplica a mesma regra ao tree do merge, e o `resume` marca a
   evidência levada adiante. As aprovações continuam presas ao conteúdo inteiro.
4. **Caminhos neutros:** `.log/` por padrão. O projeto pode declarar outros em
   `.spectree/project.json`, em `evidence.neutral_paths`. Um caminho só é neutro se também for
   documentação para o classificador de diff que já existe, então declarar `src/` não neutraliza
   nada. Uma lista malformada é recusada (`E_NEUTRAL_PATHS`).
5. `docs/reliability.md` documenta o mecanismo e o esquema de evidência ganha os dois campos.
   `tests/evidence-neutral.test.mjs` cobre o digest, o gate, os controles negativos e o CLI.

## Fora do escopo

- Mover o `.log/platform.log` para `.spectree/`, como a análise sugeria. Tornar `.log/` neutro por
  padrão tem o mesmo efeito sem mudar o card do Platform Engineer nem o histórico dos consumidores.
- Documentação neutra por padrão. Um teste pode ler um `.md` (os deste repositório leem), então só
  o projeto sabe o que é seguro declarar.

## O que esta mudança deve e não paga

Nada novo no ledger. O núcleo não muda, e a folga do D-013 continua em 44 bytes.
