# Baseline a partir de uma rodada de CI

Tarefa 20, autorizada pelo Gilson em 2026-10-24: o item 8 da análise do custo de verificação do
SYND C3a. Release: v1.58.0.

**Mudança deltaless.** Esta mudança não carrega delta em `specs/`. A baseline continua julgada do
mesmo jeito; o que muda é que uma rodada de CI que já existe passa a ser uma forma de observá-la.

## Problema

No SYND, a baseline de CI exigia rodar a suíte de novo na revisão base, mesmo quando o CI do
`main` já tinha uma rodada verde exatamente naquele commit. Era tempo e energia pagos duas vezes
pela mesma observação.

## Escopo

1. **Retro da tarefa 19** (`emenda-caminhos`), devida por esta mudança, coletada com
   `retro.mjs collect 90`.
2. **`verification.mjs baseline <change> ci --from-run <id>`:** lê a rodada pela API REST e confere
   o workflow declarado em `ci.required_runs.full` (e o evento), a conclusão, o head igual à
   revisão base e o resultado de cada job declarado. Grava uma evidência `suite.baseline` com
   `source_kind: observed_ci_run` e julga a baseline como hoje.
3. **Vermelha é baseline vermelha:** uma rodada com falha na base vira dívida anterior.
   Cancelada, pulada, incompleta, em outro commit ou de outro workflow, ela não grava nada.
4. **`observed_ci_run` vale só para `suite.baseline`** na máquina de estados, e
   `record-evidence` recusa um documento importado que se declare assim.

## Fora do escopo

Procurar a rodada sozinho a partir do commit. O id é dado por quem viu a rodada, e o comando
confere a identidade dela; adivinhar qual rodada fala pela base é o erro que o leitor de CI do
pós-merge já evita.

## O que esta mudança deve e não paga

Nada novo no ledger.
