# Ciclo 1.9 — Spectree Console: Visibilidade Operacional

## Entrega

Console local opcional, identidade monocromática da Spectree, núcleo orbital SVG original e seis especialistas do protocolo. Seleção de projetos e mudanças, pipeline de 12 estados, tarefas/dependências/tentativas, evidências filtráveis, aprovações vinculadas, histórico e inspector de origem. Atualização periódica, pausa, busca, teclado, movimento reduzido e layout responsivo.

Não há execução de agentes ou mutação dos projetos. A interface apresenta observações persistidas: início de uma missão não significa processo ativo; PASS e resultado de tarefa não certificam o candidato atual. Os requisitos do pipeline vêm da máquina de estados, mas os gates não são reavaliados pelo painel. Modelos e independência de QA não são inferidos.

## Arquitetura

- `console/`: HTML, módulos ES, CSS e SVG. Sem dependências, build ou assets externos.
- `scripts/console.mjs`: CLI com lista explícita de projetos e demonstração separada.
- `scripts/lib/console-server.mjs`: HTTP em loopback, credencial aleatória por sessão, Host/Origin/CSP, somente GET e arquivos estáticos enumerados.
- `scripts/lib/console-reader.mjs`: projeção limitada de documentos, validação de schemas/identidades, limites de leitura, recusa de symlinks/junctions. Nunca segue referências de artefatos e não executa Git ou comandos.
- Console e bibliotecas opcionais não são copiados pelo instalador Codex para consumidores.

O primeiro incremento usa módulos nativos, em continuidade com o runtime Node sem dependências. Isso evita acrescentar um framework e uma cadeia de build apenas para leitura de registros. A separação leitor/servidor/interface permite evolução posterior.

## Verificação

- `npm run check`: drift e integridade aprovados; **350/350 testes** passaram no Windows, em aproximadamente 420 segundos.
- Após endurecimento de versões/identidades e inclusão de um cenário adicional: **8/8 testes específicos do Console** passaram. Sete deles já integravam a execução completa acima.
- Browser: navegação, filtragem FAIL, busca por propriedade, inspector do registro correto, fechamento por Escape e restauração do foco; troca de mudança sem carregar evidências da anterior; pausa do movimento confirmada por estilo computado.
- Viewport desktop sem overflow horizontal; viewport móvel de 390 px inspecionado. Os screenshots são artefatos locais de revisão, separados dos registros do consumidor.
- API testada contra ausência/erro de credencial, POST, origem estrangeira, Host adulterado, Sec-Fetch-Site externo e caminhos não enumerados.
- Leitor testado com corrupção parcial, tamanho excedido, schema desconhecido, identidade divergente, junction/symlink, projeto vazio, fonte ausente e dados legados. Comparação dos arquivos da fixture antes/depois confirmou ausência de escrita.

## Observação do canário

Leitura exclusiva do `spectree-workspace`: identidade legível, zero mudanças, evidências ou dispatches estruturados; zero propostas abertas e **29 diretórios em `docs/changes/archive`**. Nenhum arquivo do consumidor foi modificado. Essa contagem não é prova de fechamento nem autoriza reconstruir histórico.

O modo demonstração usa dados sintéticos explicitamente identificados e uma sessão separada. Ele permite revisar toda a interface enquanto o canário ainda não produz os registros estruturados esperados pelo Console.

## Limites

Não há benchmark de agentes/modelos neste ciclo; os testes validam a camada de observabilidade. A leitura de múltiplos arquivos não é uma transação atômica. Os limites de leitura produzem avisos de projeção parcial. A credencial fica apenas em memória no browser: para recarregar a página, abra novamente o endereço completo do terminal. Não há compartilhamento remoto, agente em background nem controle de execução nesta versão.
