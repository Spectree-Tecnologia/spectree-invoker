# Rodada incremental do pass 2

Tarefa 33, autorizada pelo Gilson em 2026-10-25 a partir do relatório do Invoker do SYND sobre o
tempo do pass 2. Segunda de três mudanças em série. Release: v1.72.0.

**Mudança deltaless.** Esta mudança não carrega delta em `specs/`. Ela acrescenta ao runtime do squad
um registro de cobertura do pass 2 e a medição de duração; o comportamento dos projetos consumidores
não muda.

## Problema

Toda rodada do pass 2 ataca a change inteira. Depois de uma correção, a rodada seguinte ataca de novo
o código que a anterior já tinha coberto, porque nada guarda o que foi atacado nem quais mutações
morreram. E nenhuma evidência guarda quanto a rodada durou: o relatório do SYND teve de estimar pelo
histórico de transições, que mistura trabalho com espera.

## Escopo

1. **`pass2.mjs record`** registra uma rodada terminada: os arquivos atacados, cada um preso ao seu
   sha256, e, opcionalmente, a saída do `mutation-probe.mjs --apply` feita sobre o mesmo conteúdo. O
   início, o fim e o uso da rodada vêm da operação `pass2` de `work.mjs` em volta do despacho, nunca do
   relatório. O registro é recusado se a rodada não terminou completa, se o conteúdo mudou desde o fim
   dela, e uma operação vira uma rodada só uma vez.
2. **`pass2.mjs scope`** diz o que a rodada seguinte ataca: os arquivos do candidato mudados desde a
   base cujos bytes nenhuma rodada atacou, e as mutações mortas cujo alvo mudou (`rerun`) ou não
   (`carried`). Vale o último resultado de cada mutação: uma sobrevivente nunca é carregada. Também
   lista a duração e os tokens das rodadas anteriores.
3. **O registro é consultivo.** `pass2.attack` e `mutation.killed` continuam observados sobre o
   candidato inteiro e atual; o registro não autoriza nada e não entra em nenhum portão.
4. **`work.mjs finish` guarda o que o envelope do agente informa**: `totalDurationMs`, `totalTokens`
   e `totalToolUseCount` do Claude Code. Sem esses números, o uso fica desconhecido, nunca zero.
5. **Toda evidência de `state.mjs run` passa a ter `started_at` e `elapsed_ms`** do comando.
6. **O card do Quality Engineer** manda a segunda rodada atacar o que `scope` lista, e o
   `docs/workflow.md` mostra a sequência.
7. A retro de `executor-pos-fechamento` (#104), devida por esta.

## Identidade

As três rodadas da revisão independente acharam, cada uma, um caso em que o registro dizia mais do
que a rodada fez. Esta seção fixa o que cada coisa é, e a mudança volta a ser revisada contra ela:

- **Um arquivo coberto** é o seu caminho, os seus bytes e o bit de execução, como estavam quando a
  rodada terminou completa. Mudou qualquer um, ou a rodada foi interrompida, ele volta para `attack`.
- **Uma mutação** é o seu id sobre o seu alvo, porque o id só é único dentro de um plano. Vale o
  último resultado dela; carregada só quando morta e com o alvo igual.
- **Uma rodada** é uma operação `pass2` de `work.mjs` terminada com sucesso, registrada uma vez, antes
  de qualquer correção. O relatório e a saída do probe ficam sob `.spectree/`.

## Risco aceito

Uma mutação morta cujo alvo não mudou é carregada, não rodada de novo. Se a correção mudou outro
arquivo de um jeito que deixe o teste que a matava sem alcançá-la, a rodada incremental não vê. O
SYND já fazia assim por disciplina; o que muda é que agora fica registrado. O pass 2 final continua
rodando a suíte inteira, e a mutação de regra nova ou mudada continua obrigatória.

## Fora do escopo

- O harness do plugin, o cache de instalação e o banco por template: mudança 34.
- O orçamento de tempo do despacho: mudança `orcamento-de-contexto`.
- Um portão que exija o registro: ele é consultivo de propósito até ser medido num consumidor.

## O que esta mudança deve e não paga

- R-014 (lista de ações da janela de repair sem teste discriminante) segue aberto.
