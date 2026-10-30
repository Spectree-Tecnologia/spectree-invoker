# Retro — auditoria-de-codigo (#122, v1.90.0)

Change: `auditoria-de-codigo`

Escrita em 2026-10-30, depois do merge `68e6aeb`, a partir de `retro.mjs collect 122 --apply`
(`.spectree/retros/auditoria-de-codigo.signals.json`), na mudança seguinte (52).

## O que foi lido

O registro da coleta:
- CI vermelha num head (`1b0e084`, run 40970859164), verde nos seguintes;
- nenhum comentário no PR;
- a seção Atrito presente.

A assinatura `automated-checks · ci · vermelho-no-pr` casou.

## Achados

- **R-001 · identificador disputado** · `tool-economy · release · identificador-sequencial-disputado`
  · o #122 foi disputado duas vezes: esperou o #121 (v1.88.0) e depois o #123 (v1.89.0), passando
  para a v1.90.0 e trocando a retro devida. Vigésima ocorrência, [D-012](../DEFERRED.md).
- **Candidato `vermelho-no-pr`, julgado consequência do R-001, não achado novo.** O vermelho em
  `1b0e084` era a retro de `executor-cota-estruturada` exigida pelo `main` que tinha andado; o merge
  do `main` o resolveu sem mudar código.
- **R-004 · teto sem folga** · `automated-checks · protocol · teto-sem-folga` · o núcleo ficou a 24
  bytes do teto, e a regra só coube com o detalhe no card do Quality Engineer. Oitava ocorrência,
  [D-013](../DEFERRED.md). A mudança própria continua devida.

## O que funcionou

O piloto com falha plantada provou que a ferramenta reporta antes de qualquer citação, e os três
achados reais viraram adiamentos com dono e condição de fechamento testável, pagos na mudança
seguinte com teste falhando antes.
