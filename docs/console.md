# Spectree Console · ciclo 1.9

Interface local de observabilidade do squad, com a identidade monocromática da Spectree.

```powershell
npm run console -- --project C:\caminho\do\projeto
# Mais de um projeto: repita --project. Porta efêmera por padrão.
npm run console -- --project C:\projetos\a --project C:\projetos\b --port 4319
# Ambiente ilustrativo, isolado dos projetos reais:
npm run console -- --demo
```

Abra o endereço impresso no terminal. O fragmento contém uma credencial temporária da sessão; não compartilhe esse endereço. Ctrl+C encerra o servidor. Nenhuma instalação é necessária além do Node >=20.11 já exigido pelo Invoker.

## Contrato do primeiro incremento

- **Somente leitura:** nenhum processo, Git, agente, check, instalação, aprovação ou transição é executado pelo Console. Projetos são autorizados na inicialização, nunca por um caminho enviado pelo navegador.
- **Observações persistidas:** pipeline, missões, tarefas, evidências, aprovações e histórico vêm de `.spectree`. Estado registrado não comprova atividade em tempo real. Resultados PASS não certificam o candidato atual. O Console não substitui `state.mjs plan` ou os gates do runtime.
- **Ausência explícita:** sem mudanças estruturadas, o painel mostra essa condição. Pastas em `docs/changes/archive` são apenas inventário, nunca prova de integração ou fechamento.
- **Atualização:** nova leitura a cada cinco segundos enquanto a janela está visível; atualização manual e pausa disponíveis. Falhas de leitura são visíveis, inclusive arquivos corrompidos, versão desconhecida e limites. Dados anteriores ficam identificados como desatualizados quando a conexão cai.
- **Tarefas:** resultados e tentativas são relatos persistidos, sem revalidar hashes do candidato, oráculos ou processos. O estado `started` exige inspeção; não é apresentado como agente em execução. Independência de QA e modelos não são inferidos.
- **Demonstração:** dados sintéticos somente com `--demo`, com identificação permanente. Não se misturam com dados reais.

## Fronteira local

Servidor exclusivamente em `127.0.0.1`, credencial aleatória em memória, validação de Host/Origin, API GET autenticada, sem CORS, sem cookies, sem conteúdo remoto. O HTML usa CSP restritiva. Registros são tratados como texto, nunca HTML. O servidor não oferece um navegador de arquivos: somente registros operacionais previstos, com limites de quantidade/tamanho, recusa de links simbólicos/junctions e projeção explícita de campos.

Essa fronteira não pretende proteger contra processos maliciosos rodando na mesma conta, nem contra troca concorrente de diretórios por um atacante local. Os dados operacionais podem conter informação privada; mantenha a sessão local. A credencial não é persistida pelo Console.

## Critérios de aceitação

1. Selecionar projeto/mudança preserva isolamento dos registros e permite inspecionar a origem de cada observação.
2. Projeto não inicializado, projeto sem mudanças, corrupção e fonte indisponível têm estados próprios; nenhum vira sucesso.
3. Pipeline deriva da ordem do runtime; avanço registrado não cria autorização. Missões não geram indicadores fictícios de execução.
4. Tarefas mostram dependências, tentativas e resultados registrados; evidências e eventos podem ser filtrados e inspecionados.
5. Browser externo sem credencial, origem externa, mutações HTTP e caminhos arbitrários são recusados.
6. Desktop e celular, navegação por teclado, foco de diálogo restaurado e movimento reduzido são suportados.
7. Ler o projeto consumidor não altera seus arquivos. Testes usam diretórios temporários.

## Direção visual

Referência de marca: https://spectree.com.br/. Fundo `#08080A`, texto `#F2F2F3`, geometria de camadas, constelações, tipografia monoespaçada e cores restritas à semântica. Fonte local com fallback, sem baixar fontes. Núcleo e órbitas SVG originais; nenhuma dependência ou asset do APEX-UI foi copiado. O movimento é decorativo, identificado como tal, e pode ser desligado.

Frontend em módulos ES nativos + CSS + SVG, sem etapa de build. O painel permanece opcional e não é instalado nos consumidores pelo instalador do squad. Um ciclo futuro pode introduzir controles, mas deve reutilizar os comandos e a autoridade do runtime.
