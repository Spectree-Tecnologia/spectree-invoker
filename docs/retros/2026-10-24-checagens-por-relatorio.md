# Retro — checagens-por-relatorio (#84, v1.51.0)

Change: `checagens-por-relatorio`

Escrita em 2026-10-24, depois do merge `0c72ad4`, a partir de `retro.mjs collect 84 --apply`
(`.spectree/retros/checagens-por-relatorio.signals.json`), na mudança seguinte (tarefa 14).

## O que foi lido

O registro da coleta: 1 commit, 1 head de CI verde, 3 minutos entre abrir e integrar, nenhum
comentário, seção Atrito presente e o release v1.51.0 nomeado pela proposta que o próprio merge
arquivou. Nenhuma assinatura conhecida casou. O Atrito traz três itens, julgados abaixo.

## Achados

- **R-004 · 3 · checagens automáticas** · `automated-checks · protocol · teto-sem-folga` · a regra
  nova levou o `CLAUDE.md` a 46.178 bytes e o `check-plugin` recusou; coube depois de cortar 142
  bytes de redação repetida, e a folga ficou em 44 bytes. É a terceira ocorrência (a segunda foi a da
  tarefa 12b, na retro `seguranca-resposta`): a próxima regra
  no núcleo não cabe sem corte · segue no [D-013](../DEFERRED.md), cujo gatilho agora é qualquer
  regra nova no núcleo.
- **Sem achado novo:** o TAP vazio do `node --test` aninhado, que herdou `NODE_TEST_CONTEXT`, foi
  corrigido no próprio teste, do jeito que o resto da suíte já faz. A branch cortada sobre o #83
  antes do merge avançou em fast-forward, sem colisão de versão.
- **R-008 · atualização** · o Founder configurou o script de ambiente das sessões em nuvem em
  2026-10-24. O script que instala o Node 22.23.4 com checksum foi validado num container; a
  primeira sessão nova é a que confirma, e só então o R-008 fica pago.

## O que funcionou

A fila de versões coordenada entre três frentes (1.50.0, 1.51.0 e 1.52.0): nenhuma colisão, e a
retro devida passou de uma mudança para a seguinte sem ninguém reescrever a de outro.
