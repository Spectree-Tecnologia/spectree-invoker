# Retro — orcamento-de-contexto (#109, v1.76.0)

Change: `orcamento-de-contexto`

Escrita em 2026-10-26, depois do merge `d3f6d54`, a partir de `retro.mjs collect 109 --apply`
(`.spectree/retros/orcamento-de-contexto.signals.json`), na mudança seguinte (38).

## O que foi lido

O registro da coleta: três commits, um head de CI, todos os runs completos e verdes, nenhum comentário,
seção Atrito presente e o release v1.76.0 nomeado pela proposta arquivada. Nenhuma assinatura conhecida
casou na coleta.

## Achados

- **R-004 · acesso a checagens** · `automated-checks · protocol · teto-sem-folga` · o card do
  Architect, no Codex, passou o teto por 7 bytes na primeira build e ficou a 16 bytes dele. A própria
  mudança já contou esta ocorrência na linha do R-004 (sexta); esta retro não conta de novo.

## O que funcionou

A medição veio de transcripts reais do consumidor, e as duas regras atacam o que ela mostrou (missões
longas e seriais), não o tamanho dos arquivos do Invoker.
