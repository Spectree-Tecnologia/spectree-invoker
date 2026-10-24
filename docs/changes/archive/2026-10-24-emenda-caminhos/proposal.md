# Emenda de caminhos

Tarefa 19, autorizada pelo Gilson em 2026-10-24: o item 7 da análise do custo de verificação do
SYND C3a. Release: v1.57.0.

**Mudança deltaless.** Esta mudança não carrega delta em `specs/`. Ela acrescenta um comando de
estado; nenhum comportamento existente muda.

## Problema

A posse de uma mudança (`allowed_paths`) é cortada no `state.mjs open`, antes de qualquer escrita.
No SYND, a construção mostrou várias vezes que faltava um arquivo (fixture, configuração lida pelo
teste). As saídas eram reabrir a mudança, com uma rodada de escopo que ninguém precisava, ou editar
o estado à mão, sem registro do motivo.

## Escopo

1. **Retro da tarefa 18** (`tap-vitest-aninhado`), devida por esta mudança, coletada com
   `retro.mjs collect 89`.
2. **`state.mjs amend-paths <change> --add <caminho>[,<caminho>] --reason "<por quê>"`:** amplia
   `allowed_paths` e grava um evento `paths_amended` na trilha, com os caminhos, os módulos e o
   motivo. Caminho já possuído é um no-op.
3. **Para numa pessoa só num caso:** o caminho novo cai num módulo que a mudança não nomeia
   (`modules_named`, ou, sem ele, os módulos que seus caminhos já possuem). A recusa é
   `E_AMEND_NEW_MODULE`, e a rota é o Architect emendar a proposta e passar no gate 1 de novo.
   Também recusa sem motivo, depois de `integration_approved` e em estado operacional ou
   instruções.
4. Sem arquivo contratual em disco, os caminhos fazem parte do digest de escopo; o comando avisa
   que a aprovação de escopo deixou de cobrir a mudança.

## Fora do escopo

Remover caminhos da posse. Encolher a posse não destrava nada do custo medido e pede outra
pergunta: o que fazer com o que já foi escrito ali.

## O que esta mudança deve e não paga

Nada novo no ledger.
