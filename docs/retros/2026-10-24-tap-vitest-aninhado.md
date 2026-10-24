# Retro — tap-vitest-aninhado (#89, v1.56.0)

Change: `tap-vitest-aninhado`

Escrita em 2026-10-24, depois do merge `dd86760`, a partir de `retro.mjs collect 89 --apply`
(`.spectree/retros/tap-vitest-aninhado.signals.json`), na mudança seguinte (19).

## O que foi lido

O registro da coleta: 1 commit, 1 head de CI verde, nenhum comentário, seção Atrito presente e o
release v1.56.0 nomeado pela proposta que o próprio merge arquivou. Nenhuma assinatura conhecida
casou.

## Achados

- **R-008 · 5 · acesso à informação** · `information-access · ambiente · node-abaixo-do-piso` · o
  mesmo vermelho local do piso do Node nesta sessão · quinta ocorrência, aberto com o Founder até
  ser confirmado numa sessão nova.

## O que funcionou

Gravar uma execução real do Vitest antes de mexer no leitor mudou o diagnóstico: a análise previa
só o sufixo das linhas de grupo, e a fixture mostrou que a ordem dos vereditos era o defeito. Os
dois testes novos falharam com o leitor anterior antes do PR.
