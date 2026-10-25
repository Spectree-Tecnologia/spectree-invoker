# Retro — regras-de-volta-ao-nucleo (#94, v1.61.0)

Change: `regras-de-volta-ao-nucleo`

Escrita em 2026-10-25, depois do merge `316d8d1`, a partir de `retro.mjs collect 94 --apply`
(`.spectree/retros/regras-de-volta-ao-nucleo.signals.json`) e de `retro.mjs trends`, na mudança
seguinte (23).

## O que foi lido

O registro da coleta: 3 commits, 1 head de CI verde, 16 minutos aberto, nenhum comentário, seção
Atrito presente e o release v1.61.0 nomeado pela proposta arquivada. Nenhuma assinatura conhecida
casou na coleta. `trends` antes desta retro: R-008 recorrente; R-001 e R-004 quietos.

## Achados

- **R-004 · 2 · checagem automática** · `automated-checks · protocol · teto-sem-folga` · o Atrito
  registra que as regras devolvidas não couberam no teto do núcleo, e o Founder subiu o teto de
  46.080 para 49.152 bytes no cartão da thread. É a quarta vez que o teto decide o escopo de uma
  mudança, e o R-004 deixa de estar quieto. Dono: [D-013](../DEFERRED.md), cuja condição de
  fechamento (aviso de folga abaixo de 2% e orçamento de bytes na proposta) segue sem mudança
  própria; candidato ao item `retro-melhorias`.
- **R-001 · 3 · economia de ferramenta** · `tool-economy · release · identificador-sequencial-disputado`
  · o #94 e o #95 foram abertos em paralelo e disputaram versão, linha do ROADMAP e a retro devida:
  o #95 ficou vermelho no `repo-changes` até o #94 entrar, porque a retro que ele deve só existe
  depois desse merge, e o rebase teve conflito em `package.json`, `package-lock.json`,
  `plugin.json` e `ROADMAP.md`. A coordenação pela versão funcionou; o custo foi um ciclo de CI
  vermelho e um rebase. Dono: [D-012](../DEFERRED.md).

## O que funcionou

O `core_normative` foi visto recusando o diff do #76 antes do merge, e o R-009 fica pago para o
núcleo; a cobertura dos cards continua declarada no D-017.
