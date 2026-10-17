# P4 — estado da verificação

## Escopo deste registro

2026-10-17: planejamento após GO do Founder, em `codex/presence-p4-planning`,
base `8c7b099` / v1.16.0. Não houve implementação de P4 ou ensaio pago nesta etapa.
Nenhuma escrita ou teste em projetos consumidores.

## Evidência de base e inspeção

- P3-R integrada pelo [PR #48](https://github.com/Spectree-Tecnologia/spectree-invoker/pull/48).
  [Workflow do merge](https://github.com/Spectree-Tecnologia/spectree-invoker/actions/runs/38998524893)
  aprovado, tag v1.16.0 no commit de base; suíte Windows do candidato: 469/469.
  Esses resultados pertencem à P3-R, não validam funcionalidades P4.
- `presence/state.mjs` já contém Architect azul e eventos de demonstração;
  `renderer-core.mjs` suporta personagem secundário e energia por falante.
- `presence/live.mjs` fixa `specialist: null`; `presence/realtime.mjs` atribui
  saída ao Invoker. Não há especialista vivo na interface atual.
- `presence-session.mjs` fixa perfil Invoker e proíbe especialistas/ferramentas;
  P4 exige perfil e sessão próprios, sem remover as proteções existentes.
- `presence-realtime.mjs` tem somente `consultar_codex`; conclusão e cancelamento
  são correlacionados à sessão proprietária. Preservar essa garantia no novo fluxo.
- `presence-voice.mjs` já usa síntese separada, mas fixa voz `marin`, aguarda o
  arquivo completo e mantém orçamento próprio. Não comprova arbitragem de dois
  falantes, streaming da síntese ou contabilidade compartilhada com Realtime.

## Verificação documental

Proposta, tarefas e roadmap são os únicos artefatos desta mudança. Os **17 links
locais** dos quatro documentos apontam para arquivos existentes. Na abertura da
branch, HEAD e tag v1.16.0 foram consultados e resolviam para
`8c7b0999cb233cab0ffec15b71d19386b14813f7`.
Nenhum código do runtime mudou. `git diff --check` aprovado na revisão documental;
repetir sobre o conteúdo staged antes do commit. Não foi repetida a suíte completa
para documentos: nenhuma nova evidência de execução P4 pode ser inferida disso.

## Pendências para recomendar entrega

Todos os cenários A1–A15 e incrementos P4.1–P4.3 estão pendentes de implementação
e evidência. Não existe aceite de timbre `cedar` em português, fila de áudio real,
delegação dos subagentes ou desempenho P4. A consulta à documentação oficial verificou
possibilidades da API, sem testar compatibilidade desta conta ou do transporte.

Saldo conservador conhecido: US$ 0,70 do teto US$ 6, após US$ 5,30 reservados;
não é extrato do provedor. Nenhuma reserva foi reiniciada ou ampliada.

## Correção de escopo pelo Founder — 2026-10-17

O Founder esclareceu que a delegação se aplica a qualquer subagente, não apenas
ao Architect. Proposta, tarefas e roadmap foram corrigidos: ferramenta genérica,
registro dos seis papéis canônicos de `schemas/common.json`, instâncias próprias
e voz/apresentação atribuídas por participante. Architect permanece somente como
primeiro exemplo e ensaio pago; os demais papéis não ficam para outro ciclo.

A13–A15 exigem cobertura dos papéis, elegibilidade e isolamento entre instâncias.
Isso é planejamento corrigido, sem nova implementação ou evidência de execução.
Os seis IDs da tabela foram conferidos contra `schemas/common.json` e os seis
arquivos de perfil existem em `protocol/roles/`. Links locais e whitespace foram
verificados novamente após a correção.

Recomendação do planejamento: implementar P4.1 com o registro completo e provar
autoria, roteamento e cancelamento por instância antes de integrar as vozes.
