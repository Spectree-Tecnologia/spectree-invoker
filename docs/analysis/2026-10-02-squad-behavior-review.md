# Comportamento do squad no spectree-workspace — 02/10/2026

## Parecer

**Ainda são necessárias melhorias. O squad encontra defeitos reais e demonstra cuidado na integração, mas mantém controles importantes em texto, acumula contexto e registros extensos e reincide em riscos já documentados.** A prioridade é tornar o fluxo retomável e verificável, reduzir coordenação repetitiva e transformar lições recorrentes em mecanismos.

A avaliação anterior tinha uma entrevista recente e entregas anteriores ao update. Agora existe uma entrega completa de `settled-amount` executada com Invoker 1.4.0, correções de dependências e o início de `settlement-totals` com 1.5.0. Isso permite examinar execução, falhas, retomadas e integração. Ainda não permite atribuir causalmente aumento ou redução de produtividade a uma versão: as tarefas são diferentes e há espera humana, limites de uso e atualizações externas de advisories.

## Escopo, fontes e limites

- O projeto consumidor permaneceu **somente em leitura**. Não executei testes, builds, instalação, banco, migrations, fechamento, Git fetch, deploy ou chamadas à aplicação nesse projeto. Não li arquivos de ambiente, credenciais ou dumps.
- Li o Git local, specs, propostas, tarefas, configurações de testes/CI, dívida, trilha operacional e os eventos da sessão Claude e de 32 logs de subagentes referenciados no recorte. Consultei por GET os runs e jobs do GitHub para conferir resultados de CI.
- Recorte dos eventos: **27/09/2026 09:17:19 até 02/10/2026 12:33:05, America/Fortaleza**. Horários UTC aparecem somente nos identificadores e dados brutos. A sessão termina no recorte com limite de uso; não é correto tratar o trabalho em curso como entregue.
- Consumidor observado: branch `feat/settlement-totals`, HEAD `ca3d233`. Invoker local: `1.5.0`, HEAD `d7df4ab`. Os dispatches usam caminhos de **1.4.0 até a mudança 28**, e de **1.5.0 na mudança 29**. O sexto papel, TypeSafe Engineer, foi explicitamente considerado inaplicável à stack atual. Não há evidência de falha por faltar esse papel.
- Evidência de logs é identificada como tal. Resultados históricos de testes não foram repetidos por esta análise. Infraestrutura Railway e bancos não foram inspecionados diretamente; fatos dessa infraestrutura abaixo são relatos e saídas registrados na sessão, confrontados com CI quando possível.
- [Métricas derivadas](2026-10-02-squad-behavior-metrics.json) e [coletor reproduzível](2026-10-02-collect-behavior.mjs). O coletor lê as fontes e grava somente o JSON ao lado deste relatório. Não grava no consumidor.

## Estado da entrega atual

`settled-amount` foi integrado pela PR #56, em `5c44890`, em **02/10 às 01:15:27**. Conferi [CI do merge](https://github.com/Spectree-Tecnologia/spectree-workspace/actions/runs/36963760327): sucesso, tentativa 1, todos os 28 passos com sucesso. O registro local de fechamento é legado, em `.log/platform.log`, sem recibo estruturado do Invoker.

`settlement-totals` continua **em preparação de fechamento** no recorte:

| Etapa | Evidência encontrada | Limite da afirmação |
|---|---|---|
| Proposta/delta | Quatro Requirements novos; dois modificados; 16 cenários novos e cinco preservados | Contrato conferido pelo Invoker; não é prova da UI |
| Baseline local | 1.610 testes: 1.608 passaram e dois timeouts; segunda execução com um timeout | Baseline local instável, registrado explicitamente |
| Baseline remoto | [Run 37023154783](https://github.com/Spectree-Tecnologia/spectree-workspace/actions/runs/37023154783), em `e32d3f4`, verde | Commit contém documentação/trilha; código e testes são os da base `79cb39d` |
| Passe 1 | Log registra 16 testes vermelhos, cinco cenários preservados verdes | QA também conferiu os pares esperados das fixtures |
| Implementação | Commit `ca3d233`; log registra frontend 280/280, typecheck e lint verdes | Resultado local relatado, não repetido nesta análise |
| Fechamento preparado | Delta já aplicado à spec viva; três arquivos movidos no índice para archive; alterações ainda pendentes | Estado parcial; pasta em archive não prova conclusão |
| Interrupção | Subagente `a3c463fac6b933a35`: erro `rate_limit` às 12:33:00; Invoker às 12:33:05 | O retorno do harness diz `completed`, mas o conteúdo termina em limite de sessão |
| Passe 2 / CI final / merge | Não encontrados para `ca3d233` até o corte; lista remota conferida | O CI verde de `e32d3f4` não valida a implementação posterior |

Esse estado parcial é uma consequência observada da interrupção, não evidência de que o squad declarou a feature concluída. A retomada precisa reconciliar o que o comando de fechamento já escreveu antes de repeti-lo.

## O que funcionou

1. **O QA adversarial impediu perda de informação.** Na mudança 25, abrir um lançamento com valor pago e salvar somente a descrição podia substituir a previsão pelo valor efetivo e apagar a diferença. O passe 2 reproduziu isso pelo modal e pela rota; o Invoker reproduziu a falha e o Developer corrigiu. O caso passou pelos testes iniciais. Evidência: mensagens de 27/09 às 23:18–23:21; testes `settled-amount-paid-round-trip.attack.test.ts` e `settled-amount.pass2.attack.test.ts`.
2. **Houve revisão das expectativas do próprio QA.** Uma expectativa monetária incorreta foi conferida pelo Invoker em vez de aceitar automaticamente a alegação do Developer de que o teste estava errado. Na mudança 29, o QA já recalculou os pares das fixtures por uma implementação independente antes do build.
3. **Regressões preservadas passaram a receber tratamento explícito.** A mudança 29 distingue 16 novos vermelhos de cinco preservados verdes. Não exige quebrar comportamento existente para fabricar vermelho.
4. **A integração da mudança 25 foi presa ao head correto.** O log registra comparação de árvore, leitura do CI do candidato efetivamente mergeado e `--match-head-commit`. Conferi o CI de `ab3196d` e do merge. O commit de trilha mudou o head aprovado originalmente, mas ganhou uma execução própria de CI antes do merge; não foi um merge de conteúdo não testado.
5. **O escopo respeitou a stack real.** A mudança 29 reutiliza diferenças já publicadas e implementa duas somas no frontend, sem inventar backend ou migration. O Developer também derivou a grade do número de células, eliminando o literal que o Architect havia identificado como risco.
6. **O Invoker incorporou a autorização ampla do Founder.** Às 11:19 de 02/10, o comando contém a instrução de entregar sem pedidos repetitivos de autorização. A resposta posterior passa a tratar o pipeline comum como autorizado. Não há fundamento para caracterizar essa mudança de comportamento como aprovação inventada.

## Achados e melhorias prioritárias

### 1. O runtime do Invoker continua fora do caminho real — prioridade alta

**Observado.** `.spectree/{changes,dispatches,evidence,approvals,history}` continua com zero entradas; `deferred.json` tem zero itens. O log declara deliberadamente o fechamento legado e a ausência de manifest, snapshot e receipt (`.log/platform.log:3603` e `:3620`). A existência de um plugin 1.5.0 e de `.spectree` não significa uso da máquina de estados.

**Consequência.** Retomada, orçamento de tentativas, aprovações e identidade da mudança dependem de reconstruir uma narrativa extensa. A interrupção atual ocorre justamente entre escrita de artefatos e conclusão do fechamento, sem um registro estruturado da operação pendente.

**Melhoria no Invoker.** `doctor` que distingue instalação, adoção e modo legado; plano de migração/adaptação do `tools/spec-closure`; checkpoint persistente com mudança, fase, head, digests, operação iniciada, efeitos observados e próxima ação idempotente. Classificar erro de quota como `interrupted`, mesmo quando o envelope do subagente diz `completed`.

**Aceite.** Interromper em cada ponto da preparação e retomar sem reaplicar delta, perder aprovação ou marcar fechamento indevido. Declarar claramente as garantias disponíveis no modo legado, sem fabricar recibos históricos.

### 2. A regra de mutação isolada foi novamente descumprida — prioridade alta

**Observado.** `docs/DEFERRED.md:3459`, item 108, já pede mutação em cópia. Porém, em **02/10 às 12:23:22**, o Developer de `settlement-totals` copia `listing-view.ts` para `$TEMP/lv.bak` e altera o **arquivo original no checkout principal**. Às 12:23:53, copia o backup de volta. O propósito era provar que somar linhas filtradas faria um teste falhar. A mudança 25 também contém teste de mutação de arquivo do core no checkout.

**Consequência.** Um limite, falha de ferramenta ou leitor concorrente durante essa janela pode deixar ou observar código intencionalmente errado. Não encontrei evidência de mutante sobrevivente no snapshot. A restauração observada não transforma o procedimento em isolado.

**Melhoria no Invoker.** Ferramenta de mutation probe que materializa o candidato em cópia descartável, aplica o mutante e executa o teste lá. Exigir ambiente/banco próprio quando necessário. Proibir edição temporária de produção no checkout compartilhado para esse fim, inclusive pelo Developer; não depender da disciplina manual de restaurar depois.

**Aceite.** Matar o processo durante a mutação mantém a árvore principal byte-idêntica ao candidato anterior. A evidência deve registrar qual mutante foi morto, sem generalizar isso como prova de cobertura de todo defeito possível.

### 3. A auditoria de dependências impede obter outras evidências de CI — prioridade alta

**Observado diretamente no GitHub.** Nos runs [36649431336](https://github.com/Spectree-Tecnologia/spectree-workspace/actions/runs/36649431336), [36793847465](https://github.com/Spectree-Tecnologia/spectree-workspace/actions/runs/36793847465) e [36804343818](https://github.com/Spectree-Tecnologia/spectree-workspace/actions/runs/36804343818), o audit bloqueante falhou; secret scan, typecheck, lint, specs, migrations, testes, build e browser foram pulados. Todos estão na mesma sequência de passos de `verify`.

As mudanças 27 e 28 precisaram ser combinadas porque cada candidato isolado mantinha o achado corrigido pelo outro. Houve três propostas, worktrees, encerramentos e acertos de sequência nas mudanças 26–28 antes de voltar à feature 25. Nem toda essa demora é desperdício: novos advisories e espera humana também interferiram.

**Melhoria no consumidor, a ser entregue por atualização de fluxo do Invoker.** Separar audit e validação funcional em jobs independentes. Um gate agregador permanece bloqueado se qualquer prova obrigatória falhar; todos os diagnósticos úteis aparecem na mesma execução. Fazer triagem do conjunto de atualizações conhecidas antes de criar mudanças isoladas que se bloqueiem mutuamente. Distinguir inventário de dependências, presença na imagem e alcance em runtime, sem dispensar automaticamente risco de build/dev.

**Aceite.** Audit vermelho impede aprovação final, mas não impede obter o resultado da suíte e do build. Atualizações combinadas recebem escopo e candidato explícitos, sem reescrever a história original.

### 4. A causa dos testes instáveis foi declarada com certeza excessiva — prioridade alta

**Observado.** A baseline da mudança 29 produziu dois resultados locais diferentes no mesmo conteúdo. Os testes de comprovantes passaram isolados e falharam por timeout sob a suíte completa. O CI da base passou. O log conclui em `.log/platform.log:3698` que a instabilidade é característica da estação e **não da suíte**.

**Problema da conclusão.** As observações sustentam sensibilidade a ambiente/carga; não isolam a causa. Um verde no CI não elimina acoplamento, disputa de recursos, custo de importação ou sincronização frágil no próprio teste. Os testes inspecionados incluem importação dinâmica do modal e esperas fixas de 30/50 ms. Isso é material para investigação, não prova de que essas linhas causaram os timeouts. O item 129 ainda explica a situação por processos do backend, enquanto a falha atual é do frontend.

**Melhoria.** Separar `observado`, `hipótese` e `causa reproduzida` nos relatórios. Investigar frio/quente, frontend isolado/monorepo e concorrência de workers com rodadas definidas; medir importação, setup e execução separadamente. Formalizar quando um CI da mesma base pode servir como baseline válida e conservar o problema local aberto.

**Aceite.** Uma intervenção específica remove a falha na condição que a reproduzia; desfazê-la recupera a falha quando viável. Não resolver apenas aumentando timeout ou escolhendo o resultado verde.

### 5. O contexto e os handoffs ficaram muito extensos — prioridade alta

**Medido.** No recorte, o Invoker fez **31 chamadas `Agent`**, além de follow-ups. Distribuição: 15 Platform, seis QA, cinco Architect, três Developer e duas Integration. Os prompts dessas chamadas têm mediana de **1.190 palavras**, mínimo 753 e máximo 1.481; somam 36.324 palavras, antes das leituras obrigatórias.

A telemetria dos 196 IDs únicos de mensagens reais do Invoker registra mediana de **449.222 tokens de entrada por requisição, incluindo cache**, e máximo de 831.266. São 89,3 milhões de tokens de cache lido somados no recorte, não 89,3 milhões de conteúdo exclusivo nem estimativa de cobrança. Não usei esses valores para estimar dinheiro ou afirmar que causaram os limites. Todos os modelos registrados nesse conjunto e nos filhos inspecionados são `claude-opus-5`.

O log registra seis eventos `rate_limit` no Invoker, incluindo dois com nove segundos de intervalo; portanto não são seis interrupções independentes. Três mensagens humanas pedem explicitamente retomada por limite, e a execução atual também termina por esse motivo.

**Melhoria no Invoker.** Contexto novo por mudança ou fase com checkpoint estruturado e evidências recuperáveis. Dispatch curto: ID da tarefa, diferença em relação ao contrato, referências, limites e critério de saída. Evitar repetir a missão que `tasks.md` já contém. Retornar resumo e refs verificáveis, preservando a trilha detalhada fora do contexto rotineiro. Calibrar modelo/esforço por missão depois de criar uma avaliação comparável; a amostra atual não compara modelos.

**Aceite.** Uma retomada em contexto novo preserva decisões, aprovações e riscos pendentes. Medir entrada, duração e falhas em tarefas equivalentes; não impor redução arbitrária de tokens que elimine informações necessárias.

### 6. O log operacional tornou-se um recurso compartilhado que bloqueia trabalho — prioridade alta

**Observado.** `.log/platform.log` tem **1.857.578 bytes**, aproximadamente **279.765 palavras**, em 3.716 linhas. O número pequeno de linhas esconde blocos muito longos. Em `.log/platform.log:3202`, o merge de `main` foi recusado por alterações locais nesse arquivo. Combinações posteriores exigiram preservar e reconciliar a trilha. Os commits `b35ffc9`, `3fd6357`, `c3acb31` e `ab3196d` transportam registros de trilha; o pós-merge ainda exigiu `79cb39d`.

O `ab3196d`, contendo apenas 46 linhas adicionais de log, gerou CI próprio antes do merge. Isso foi prudente com o desenho vigente, mas evidencia que o desenho faz registro de evidência alterar o candidato cuja evidência precisa ser produzida.

**Melhoria.** Eventos append-only por mudança/execução, com arquivos imutáveis separados e índice consultável. Guardar provas de operações relevantes com retenção durável e digest; gerar a narrativa compacta para pessoas. O resumo de status não deve exigir ler a história integral nem repetir listas de tudo que o agente não fez. Planejar exportação de evidências sem criar ciclo recursivo de commit sobre CI.

**Aceite.** Dois agentes registram eventos sem disputar o mesmo arquivo. Fechamento e retomada não precisam de commit de reconciliação da trilha. Provas de operações em dados reais permanecem auditáveis e duráveis.

### 7. Cobertura de cenários ainda não garante os fluxos que preservam dados — prioridade alta

**Observado.** O passe 2 encontrou a regressão de ida e volta do formulário depois dos testes iniciais verdes. A leitura publicava o valor efetivo, enquanto o formulário interpretava o mesmo campo como previsão. Na mudança 29, a proposta e as tarefas vedam teste de render/browser dos rodapés, mantendo a dívida visual. Essas restrições são escolhas explícitas do projeto; não são falta de conhecimento do QA.

**Melhoria.** Acrescentar uma matriz de fluxos obrigatórios quando mudar significado de campo: criar, ler, abrir edição, salvar sem mudar o valor, editar outro campo e reler. Testar invariantes entre a forma publicada e o comando de escrita. Escolher verificação de UI por risco do comportamento, revisitando limites antigos de cobertura quando deixam uma superfície relevante sem prova. Manter o passe 2 adversarial.

**Aceite.** O defeito de sobrescrever previsão vira regressão permanente. A função pura correta deixa de ser aceita como prova suficiente de que o formulário ou rodapé conectado usa o valor correto.

### 8. O squad registra lições, mas não as converte em controles — prioridade alta

**Medido no Git.**

| Revisão | Itens totais | Fechados | Abertos |
|---|---:|---:|---:|
| `1fbe995`, base da análise anterior | 108 | 24 | 84 |
| `5c44890`, merge de `settled-amount` | 118 | 24 | 94 |
| `79cb39d`, após atualização da dívida | 131 | 24 | 107 |

São **23 novos itens abertos (+27,4%)**, sem aumento de fechamentos nesse intervalo. Isso não significa 23 bugs novos: mistura limitações de produto, segurança operacional, dúvidas, lições e riscos latentes. O item 110 será atendido pela mudança 29, mas ainda está aberto no snapshot. O registro tem 301.849 bytes e 47.662 palavras; o JSON estruturado está vazio.

**Melhoria.** Separar defeito, risco aceito, decisão pendente, hipótese e lição já convertida em regra. Dar owner e gatilho; promover recorrências como mutação compartilhada e retomada manual a trabalho de confiabilidade prioritário. Gerar contagens e histórico a partir de registros canônicos. Exemplos: itens 119, 128 e 131 podem resultar em guardas pequenas, em vez de exigir releitura permanente.

**Aceite.** Um novo achado aponta para item existente quando é recorrência. A aplicação de uma regra resolve a lição correspondente; limitações aceitas não inflam o mesmo indicador de defeitos a corrigir.

### 9. A evidência de alguns checks não discrimina o risco declarado — prioridade média/alta

**Observado.** `docs/DEFERRED.md:3840`, item 131, registra que uma comparação de população de arquivos não poderia detectar a falha de configuração de regras que pretendia cobrir na mudança de dependência. O número permaneceria igual mesmo com a expansão defeituosa.

**Melhoria no Invoker.** Exigir que cada check novo diga: qual hipótese testa, qual entrada defeituosa muda o resultado e qual parte permanece não observada. Para casos críticos, incluir controle negativo. Não transformar a tabela de contagens ou a existência de um comando em evidência de comportamento que ele não exercita.

**Aceite.** Um defeito semeado relevante faz o check falhar. Remover checks sem poder discriminante, mantendo verificações úteis de inventário identificadas apenas como inventário.

### 10. Deploy e recuperação precisam de política operacional verificável — prioridade alta

**Observado na trilha.** A mudança 25 teve deploy iniciado cerca de dois segundos após o merge, antes do CI de `main`, com migration no pre-boot (`.log/platform.log:3617–3619`). **Já havia CI verde no candidato e identidade de árvore verificada**: não é correto dizer que a mudança foi para produção sem teste algum. A lacuna é a ausência relatada de uma barreira da plataforma condicionada à prova exigida, deixando a sequência depender do agente e das configurações externas.

O item 126 registra backup do banco real de **desenvolvimento** em diretório temporário, e a ausência do dump equivalente anterior. Não investiguei o inventário de backups da produção; esse item não prova que a produção tenha exatamente um backup.

**Melhoria.** Uma política explícita de deploy por SHA aprovado, distinguindo CI do candidato, merge e verificação pós-deploy; migration com alvo identificado, backup durável conforme política do proprietário, retenção e prova de restauração em ambiente descartável. Não usar a existência de dump temporário como evidência de recuperação duradoura.

**Aceite.** A plataforma recusa artefato sem a prova definida; o rollback/restore tem artefato acessível após a sessão e procedimento testado. A proposta deve respeitar a infraestrutura e permissões reais, sem presumir que editar YAML sozinho controle o trigger externo.

### 11. Documentos descritivos e estado atual já divergem — prioridade média

**Observado.** O item 123 afirma que qualquer push, inclusive documentação, dispara deploy. O bloco imediatamente posterior à atualização desse backlog registra ambos os serviços como `SKIPPED`, pois nenhum arquivo observado por seus filtros mudou (`.log/platform.log:3646–3654`). A parte "não espera CI" continua relevante; a generalização "inclui qualquer documentação" ficou refutada.

Também há várias referências a números de linha históricos e contagens que precisam ser recalculadas manualmente. A proposta da mudança 29 registra uma referência antiga que passou a apontar para outro Requirement.

**Melhoria.** Fatos operacionais com fonte, instante, revisão e condição; separar histórico imutável da visão atual corrigível. Referências por IDs estáveis de Requirement/Scenario, com linhas como conveniência. Corrigir a visão atual assim que uma observação a refuta, preservando a versão histórica.

**Aceite.** Uma nova sessão não recebe simultaneamente duas afirmações contraditórias como verdade vigente. Nenhuma atualização apaga o fato de que a afirmação anterior existiu.

### 12. A cerimônia não está proporcional ao tamanho de algumas mudanças — prioridade média

**Observado.** Para duas somas já possíveis a partir dos dados do frontend, a mudança 29 produziu proposta de **551 linhas/7.144 palavras** e tarefas de **247 linhas/2.369 palavras**. Isso não inclui o delta. Houve cinco dispatches entre proposta e interrupção, todos síncronos. O build do Developer durou aproximadamente 9m44s segundo o harness; Architect 17m50s, branch/baseline 20m04s, QA 11m51s e a preparação interrompida 6m11s. Essas durações incluem ferramentas; não são tempo de raciocínio puro ou desperdício automaticamente.

**Melhoria.** Perfil compacto para mudança pequena: escopo, decisão, impacto, cenários e riscos específicos, com referências às regras comuns. Evitar repetir toda a história e listas extensas de ausências em cada artefato. Agrupar operações determinísticas do Platform quando não houver um gate ou entrada nova entre elas. Preservar a decisão do usuário de operar com autonomia, registrando uma vez seus limites por mudança.

**Aceite.** Reduzir palavras, handoffs e comandos repetidos mantendo os mesmos defeitos detectáveis. Medir qualidade e duração, não apenas quantidade de documentação produzida.

## Ordem recomendada para os próximos updates

| Ordem | Entrega no Invoker | Resultado concreto esperado |
|---|---|---|
| 1 | Checkpoint/retomada, classificação de interrupção e diagnóstico de adoção | Recuperar o fechamento em andamento com estado preciso |
| 2 | Mutation probe isolado e verificações de ambiente | Impedir reincidência do item 108 |
| 3 | Dispatch/contexto compactos e eventos por execução | Menos releitura, disputa de log e perda por sessão longa |
| 4 | Matriz de fluxos de dados e checks com controle negativo | Encontrar antes regressões de ida e volta e provas incapazes de falhar |
| 5 | Fluxo de CI independente, baseline formal e investigação de instabilidade | Receber todos os diagnósticos do candidato sem transformar instabilidade em verde |
| 6 | Adoção do estado estruturado, dívida tipada e política de entrega/recuperação | Converter regras de texto em garantias e indicadores confiáveis |

Mudanças na infraestrutura e no consumidor precisam ser executadas em trabalho próprio com permissão de escrita; esta análise apenas as descreve. A primeira entrega pode ser feita no Invoker com testes em consumidores sintéticos e um plano de adoção revisável.

## Conclusão operacional

Preservaria o QA adversarial e a verificação de identidade do candidato. Os maiores problemas demonstrados são a persistência de estado fora do runtime, a repetição de riscos já conhecidos, a fragilidade de retomada e o volume de contexto/trilha. A próxima melhoria deve provar que uma sessão interrompida retoma corretamente e que um risco já registrado deixa de se repetir — dois resultados mais úteis do que adicionar outro papel ou ampliar instruções indiscriminadamente.
