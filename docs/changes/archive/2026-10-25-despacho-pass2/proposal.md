# Despacho do pass 2 com independência e escopo final

Tarefa 36, autorizada pelo Gilson em 2026-10-25 a partir dos desvios da retro da change passkeys do
SYND (discovery em `/mnt/project-files/analysis/retro-passkeys-desvios.md`). Segunda de duas, depois
da 35. Release: v1.75.0.

**Mudança deltaless.** Esta mudança não carrega delta em `specs/`. Ela muda o que o runtime do squad
exige para abrir e fechar uma rodada do pass 2; o comportamento dos projetos consumidores não muda.

## Problema

Na change passkeys do SYND, o Invoker esqueceu a declaração de independência no despacho do pass 2 e
mandou a ordem de reduzir o escopo depois que o Quality Engineer já tinha começado. O runtime já exige
`independent_of` na evidência `pass2.attack`, mas como bandeira que quem chama digita; o despacho em si
não tinha forma fixa, e a operação `pass2` de `work.mjs` não guardava escopo nenhum.

## Escopo

1. **`work.mjs start --phase pass2` exige `--brief <arquivo.json>`**, escrito antes do despacho:
   `independent_of` com `full_stack_developer`, `fork: false`, `withheld` com `builder_report`,
   `builder_reasoning` e `pull_request`, e `scope.attack` (1..500) com `scope.excluded`, lista explícita
   mesmo vazia. Faltou ou veio malformado, `E_PASS2_BRIEF`. O evento `started` guarda o caminho, o sha256,
   `independent_of` e as contagens.
2. **`work.mjs finish` recusa `E_PASS2_SCOPE_MOVED`** quando os bytes do brief mudaram, ou ele sumiu,
   depois do início. A operação fica pendente até `reconcile`, e o novo escopo é uma operação nova.
3. **Operação `pass2` aberta antes desta versão** não tem brief e segue fechando; outras fases não pedem brief.
4. **Template no `commands/invoker.md`**, uma frase no perfil `protocol/runtime/review.md`, a sequência em
   `docs/workflow.md` e o porquê em `docs/protocol-rationale.md`.
5. **Testes discriminantes** em `tests/pass2-brief.test.mjs`, vistos vermelhos sem o código; os testes do
   registro de cobertura passam a abrir as rodadas com brief.
6. A retro de `contraexemplo-concorrente` (#105), devida por esta.

## Identidade

- **Um brief** é um arquivo regular dentro do projeto, sob `.spectree/pass2/` por convenção (fora do
  conteúdo que a rodada ataca), lido como JSON na versão 1. Sua identidade são os bytes, pinados no
  `started`.
- **O escopo de uma rodada** é o que o brief diz no início dela. Qualquer byte do brief que mude antes do
  `finish`, inclusive fora de `scope`, é escopo movido: o runtime não compara campos, compara bytes.
- **Em quem o brief confia:** em quem escreve em `.spectree/`, como todo o resto do rastro operacional. Ele
  declara; não prova que o texto entregue ao agente o continha.

## Fora do escopo

- A regra no núcleo: o núcleo está a 58 bytes do teto (R-004, D-013), e a regra cabe no comando, no perfil
  e no runtime que a cobra.
- Ligar a evidência `pass2.attack` de `state.mjs run` a uma operação com brief: D-023.
- A detecção do navegador em `capabilities.mjs`: proposta, não autorizada.

## O que esta mudança deve e não paga

- D-023: o brief prova o que o Invoker declarou, não o que o Quality Engineer recebeu, e a evidência
  `pass2.attack` ainda aceita `--independent-of` sem uma operação `pass2` com brief por trás.
