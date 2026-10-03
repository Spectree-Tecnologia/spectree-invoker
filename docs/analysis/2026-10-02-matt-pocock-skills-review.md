# Aplicabilidade de mattpocock/skills ao Spectree Invoker

Análise iniciada em 02/10/2026 e concluída em 03/10/2026.

## Parecer

Há soluções aproveitáveis, principalmente para decomposição de trabalho, seleção de contexto, diagnóstico e revisão. `implement-spec` fornece um desenho útil para parte da próxima evolução: executar uma spec por meio de tarefas com dependências. Entretanto, na revisão inspecionada, essa orquestração é uma instrução ao agente. Não encontrei um executor durável, um runner de avaliações de agentes, roteamento empírico de modelos ou prova de isolamento do QA.

Recomendação: adaptar os mecanismos de trabalho ao protocolo e runtime existentes, mantendo `protocol/` como fonte dos artefatos gerados. A instalação integral das skills introduziria convenções concorrentes de aprovação, Git, testes e conclusão.

## Escopo e identidade das fontes

- Repositório externo: [mattpocock/skills](https://github.com/mattpocock/skills).
- Revisão consultada na API pública: `d81f3a183412e71a5b1e84ca21bc1a35eea03a60`, commit de 29/09/2026; `package.json` declara 1.2.3.
- Inventário completo da árvore e leitura direcionada das skills relevantes, arquivos auxiliares, configuração e scripts. Arquivo público dessa revisão baixado e extraído em diretório temporário, sem instalação ou execução.
- Comparação com o Invoker local, incluindo as melhorias ainda não commitadas, e com os achados da [auditoria anterior do consumidor](2026-10-02-squad-behavior-review.md). Esta comparação não é uma nova medição de produção.
- Nenhuma alteração no `spectree-workspace`. Esta etapa acrescenta somente este relatório no Invoker.
- Avaliação estática: utilidade e riscos descritos abaixo são análise de desenho. Ganhos de tempo, tokens e qualidade continuam hipóteses a medir.

## O que incorporar

| Prioridade | Origem | Adaptação proposta | Destino no Invoker |
|---|---|---|---|
| Alta | `to-tickets` + `implement-spec` | Tarefas pequenas e verificáveis, dependências explícitas e seleção das tarefas liberadas | Plano de tarefas, planner e futuro executor |
| Alta | `writing-for-agents` | Contexto por papel e fase; referências com condições claras de leitura | Fontes em `protocol/` e geração dos adapters |
| Alta | `diagnosing-bugs` | Reprodução do sintoma, hipóteses testáveis, intervenção e regressão | QA, Developer, plano de verificação e evidências |
| Alta | `code-review` | Avaliar separadamente aderência à spec e padrões de código | Relatório do passe 2, preservando prova comportamental |
| Média | `tdd` + `to-spec` | Definir interfaces observáveis e expectativas independentes da implementação | Planejamento de verificação e ciclos de implementação |
| Média | `retro` | Converter incidentes recorrentes em checks e casos de avaliação | Backlog de confiabilidade e avaliações reais |
| Média | `domain-modeling` | Glossários por contexto e decisões arquiteturais seletivas | Architect e documentação de domínio |
| Complementar | `handoff` + `wayfinder` | Resumos derivados do estado e navegação por decisões pendentes | Retomada e exploração de missões longas |

### 1. Dependências executáveis e fatias verificáveis

[`to-tickets`](https://github.com/mattpocock/skills/blob/d81f3a183412e71a5b1e84ca21bc1a35eea03a60/skills/engineering/to-tickets/SKILL.md) propõe entregas estreitas que atravessam as camadas necessárias e explicitam seus bloqueadores. Também contempla migrações amplas com expansão compatível, migração em lotes e remoção posterior da forma antiga. Isso é útil para evitar tarefas que se dizem independentes, mas só funcionam quando integradas.

[`implement-spec`](https://github.com/mattpocock/skills/blob/d81f3a183412e71a5b1e84ca21bc1a35eea03a60/skills/engineering/implement-spec/SKILL.md) despacha a fronteira disponível, usa worktrees por implementador e integra os resultados em uma branch. Podemos reaproveitar essa lógica de seleção. No Invoker, a execução precisa ainda respeitar ownership, gates, orçamento e reconciliação de operações interrompidas.

Proposta de contrato: ID estável da tarefa, referências aos Scenarios, dependências, caminhos permitidos, revisão de entrada e critérios de saída. A aquisição da tarefa deve ser atômica, com identidade de tentativa; a conclusão deve exigir evidência válida para o candidato atual. Dependência concluída por relato do agente não basta.

A política de worktrees precisa de adaptação explícita: hoje o protocolo descreve QA e Developers trabalhando na branch da mudança. A topologia externa de múltiplas branches afeta baseline, integração e identidade da evidência. Não copiar a instrução de resetar uma branch sem verificar alterações, nem limpar worktrees antes da reconciliação. Operações Git continuam sob autoridade do Platform Engineer.

### 2. Contexto selecionado por fase

[`writing-for-agents`](https://github.com/mattpocock/skills/blob/d81f3a183412e71a5b1e84ca21bc1a35eea03a60/skills/productivity/writing-for-agents/SKILL.md) distingue material sempre carregado de referências consultadas sob condições específicas. Isso complementa nosso limite orientativo de 400 palavras: um dispatch curto ainda pode mandar o agente ler documentos inteiros desnecessariamente.

Proponho um núcleo permanente de autoridade, identidade da mudança e regras críticas, acompanhado de referências por papel/fase. O gerador preserva a fonte única; o executor registra quais versões compuseram o contexto. A validação precisa testar tanto referências ausentes quanto comportamento em situações que exigem buscar uma regra condicional.

Na auditoria anterior, os dispatches tinham mediana de 1.190 palavras, antes das leituras. Essa é uma motivação concreta, mas não comprova que uma reorganização específica reduzirá custo ou erros.

### 3. Diagnóstico que separa fato de hipótese

[`diagnosing-bugs`](https://github.com/mattpocock/skills/blob/d81f3a183412e71a5b1e84ca21bc1a35eea03a60/skills/engineering/diagnosing-bugs/SKILL.md) organiza reprodução, redução do caso, hipóteses falsificáveis, instrumentação e regressão. É especialmente pertinente ao achado de timeouts atribuídos à estação sem causa isolada.

Adaptar um registro de diagnóstico ligado à operação existente: sintoma, comando, ambiente, frequência observada, hipótese, intervenção e resultado. Falha não reproduzida permanece inconclusiva. Um rerun verde não apaga a falha anterior. Para bugs intermitentes, comparar frequência sob condições registradas; para regressões de desempenho, medir a baseline antes da intervenção.

Não incorporaria como regra absoluta a proibição de formular hipóteses antes de existir um reproducer: investigação e hipóteses podem ser necessárias para construí-lo. O requisito útil é não apresentar hipótese como causa demonstrada.

### 4. Revisão em dois eixos

[`code-review`](https://github.com/mattpocock/skills/blob/d81f3a183412e71a5b1e84ca21bc1a35eea03a60/skills/engineering/code-review/SKILL.md) separa conformidade com padrões e aderência à spec. Isso reduz a chance de discutir organização do código enquanto um requisito permanece ausente. Também distingue heurísticas de design de violações documentadas.

Adotar os dois eixos no relatório, com severidade, referência e evidência. Sugestão estética não vira automaticamente bloqueio. Revisão de diff não substitui execução adversarial nem controle negativo.

Há duas limitações relevantes: a receita compara commits até `HEAD`, deixando alterações não commitadas fora desse diff; e separar revisores em subagentes não demonstra isolamento de capacidades. Nossa revisão deve estar vinculada ao candidato exato, incluindo o conteúdo efetivamente submetido, e conservar as recusas relacionadas à independência não comprovada.

### 5. TDD: contribuição importante, com conflito de protocolo

[`tdd`](https://github.com/mattpocock/skills/blob/d81f3a183412e71a5b1e84ca21bc1a35eea03a60/skills/engineering/tdd/SKILL.md) favorece ciclos pequenos de teste e implementação, expectativas independentes e testes em interfaces observáveis. Critica escrever todos os testes antes de implementar tudo. Na versão consultada, também desloca refatoração para a revisão; isso é uma escolha do autor, não uma regra universal de TDD.

Nosso protocolo exige mapear todos os Scenarios no passe 1 antes de qualquer Developer começar. Isso tem uma finalidade legítima: contrato independente da implementação. Entretanto, um lote grande pode antecipar detalhes ainda não estabilizados e aumentar retrabalho. A crítica externa é um motivo para avaliar a granularidade, não uma prova de que todo nosso passe 1 esteja errado.

Adaptação inicial: reduzir o tamanho das mudanças, manter o contrato de aceitação independente e permitir ciclos internos pequenos ao Developer. Uma futura liberação do passe 1 por fatia exige alteração explícita de estados e gates, com dependências verificadas e passe 2 preservado.

[`to-spec`](https://github.com/mattpocock/skills/blob/d81f3a183412e71a5b1e84ca21bc1a35eea03a60/skills/engineering/to-spec/SKILL.md) acrescenta a escolha prévia das interfaces a testar. Esse conteúdo cabe em `verification.json`; não precisamos importar seu formato extenso de histórias nem criar outra spec autoritativa.

### 6. Aprendizado, domínio e retomada

[`retro`](https://github.com/mattpocock/skills/blob/d81f3a183412e71a5b1e84ca21bc1a35eea03a60/skills/engineering/retro/SKILL.md) prioriza automatizar verificações quando possível, em vez de acumular instruções. Para nós: incidente → caso reproduzível → check ou avaliação → validação da próxima versão. Não implica permitir que um agente reescreva automaticamente suas regras após um episódio.

[`domain-modeling`](https://github.com/mattpocock/skills/blob/d81f3a183412e71a5b1e84ca21bc1a35eea03a60/skills/engineering/domain-modeling/SKILL.md) combina com os bounded contexts já presentes no Architect. É refinamento: glossários locais e ADRs para decisões relevantes, sem impor um vocabulário global que apague diferenças legítimas entre contextos.

[`handoff`](https://github.com/mattpocock/skills/blob/d81f3a183412e71a5b1e84ca21bc1a35eea03a60/skills/productivity/handoff/SKILL.md) orienta resumos portáveis e referências, mas usa diretório temporário. Nosso checkpoint durável permanece a autoridade; podemos gerar dele um resumo descartável. [`wayfinder`](https://github.com/mattpocock/skills/blob/d81f3a183412e71a5b1e84ca21bc1a35eea03a60/skills/engineering/wayfinder/SKILL.md) contribui com planejamento progressivo de decisões, área em que já temos exploração por fronteira.

## Quanto resolve da evolução proposta

| Evolução | Cobertura encontrada | Trabalho ainda necessário |
|---|---|---|
| Executor controlado | Desenho de tarefas, dependências, dispatch e integração | Execução pelo adapter, aquisição atômica, persistência, verificação e recuperação de efeitos incertos |
| Avaliações reais de agentes | Disciplina de diagnóstico e retrospectiva | Runner com agentes reais, projetos descartáveis, resultados observados e comparação entre versões |
| Scenario → teste → evidência | Critérios por ticket e revisão contra a spec | IDs e vínculos executáveis, fingerprints e invalidação após mudança |
| Roteamento de modelos | Não encontrei política empírica implementada | Medir qualidade, custo e tempo por missão; decidir por resultados comparáveis |
| Isolamento verificável do QA | Separação lógica de revisores | Controle de acesso e sinal observado de isolamento no harness |

O limite atual das nossas avaliações está declarado em `tests/evaluations.test.mjs`: elas verificam fixtures, não o comportamento de agentes. O limite de isolamento continua documentado como M4 em `docs/maintenance.md`. Nenhuma skill examinada fecha esses dois itens por si só.

## O que não importar diretamente

- **Hook Git como barreira de segurança.** O [script Bash](https://github.com/mattpocock/skills/blob/d81f3a183412e71a5b1e84ca21bc1a35eea03a60/skills/misc/git-guardrails-claude-code/scripts/block-dangerous-git.sh) usa padrões textuais. Pela leitura estática, `git -C caminho push` não corresponde ao padrão simples `git push`; texto citado pode gerar falso positivo. Também depende de Bash/jq/grep. Não equivale a validação estruturada de operações entre harnesses e PowerShell.
- **Mais aprovações rotineiras.** Algumas receitas pedem confirmação de granularidade e interfaces de teste. No Invoker, reutilizar a autorização e os gates pertinentes, evitando perguntar novamente o que já foi aprovado.
- **Conclusão por ticket fechado.** Resolver issue ou marcar PR pronta é um efeito do workflow externo; não substitui nosso aceite e evidência de integração.
- **Heurísticas de contexto como limite universal.** Recomendações numéricas de janela e divisão de sessões precisam de medição por modelo/harness.
- **Configuração experimental de arquitetura sem adaptação.** A configuração com dependency-cruiser em `in-progress/setup-ts-deep-modules` pode inspirar validação semântica de imports, mas assume uma estrutura TypeScript específica. É uma melhoria posterior e condicionada à stack.

O repositório declara [licença MIT](https://github.com/mattpocock/skills/blob/d81f3a183412e71a5b1e84ca21bc1a35eea03a60/LICENSE). Se copiarmos ou adaptarmos trechos substanciais, preservar o aviso de licença e atribuição.

## Próximo incremento recomendado

1. **Base de comparação:** converter incidentes já observados em tarefas de avaliação executadas por agentes em consumidores descartáveis. Incluir quota com envelope enganoso, fechamento interrompido, baseline intermitente, teste insensível ao defeito e alteração de candidato após revisão.
2. **Melhorias de protocolo:** contexto por fase, diagnóstico estruturado e revisão em dois eixos. Medir antes/depois nas mesmas tarefas, mantendo modelo e ambiente comparáveis.
3. **Executor inicial:** persistir o grafo e executar primeiro uma tarefa por vez pelo adapter. Validar dependências, autorização, revisão e evidência; reconciliar interrupções antes de repetir efeitos. Expandir concorrência e worktrees somente após esse caminho funcionar.
4. **Rastreabilidade e seleção de modelos:** ligar resultados aos Scenarios e usar as avaliações para comparar configurações de modelo/esforço. Não escolher modelos por reputação ou presumir economia sem dados de execução.

Aceite do incremento: nenhuma tarefa liberada com bloqueador pendente; nenhuma interrupção tratada como sucesso; nenhuma repetição cega de efeito incerto; evidências invalidadas quando seus inputs mudarem; resultado comportamental mantido ou melhorado nas avaliações. Reportar separadamente tempo do agente/ferramentas, espera de CI e espera humana. Não declarar garantia de execução exatamente uma vez para efeitos externos sem suporte e reconciliação do destino.

Minha visão atualizada: Matt oferece boas receitas para o trabalho que ocorre dentro das etapas. A evolução do Invoker deve combinar essas receitas com execução observável, estado durável e avaliações que demonstrem quando o squad melhorou.
