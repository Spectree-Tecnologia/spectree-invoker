# Verificação — Presence P2

Concluída em 2026-10-15 na branch `codex/presence-sessao-codex`, baseada em
`80f5dfb637d1d27f3690fb9df3c0a50a2a911806` (main / v1.14.0, P1 integrada).
Este registro não autoriza merge nem declara uma nova release.

## Resultado

- `npm run check`: **427/427 testes passaram**, sem falhas, cancelamentos ou
  testes ignorados; duração 367.979 ms. Inclui drift dos artefatos gerados,
  validação do plugin e regressão completa. A execução anterior, antes dos
  últimos casos de robustez, também passou (425/425).
- A Presence tem 31 testes: 20 da fundação P1 e 11 novos de sessão, transporte
  e cliente. Os novos casos cobrem autenticação, isolamento confirmado,
  concorrência, eventos atrasados, interrupção, falhas, limites, UTF-8,
  autorização HTTP, duplicação de requisições e confirmação perdida no envio.
- `git diff --check`: sem erros de whitespace.
- Não foram adicionadas dependências nem alterado o protocolo gerado.

O diagnóstico `fatal: bad object 000...` no log da suíte é provocado pelo teste
de comparação Git indisponível; o caso passou e a execução terminou com código 0.

## Canário real

Executado explicitamente com `node scripts/presence-canary.mjs --live`, usando
a autenticação ChatGPT já gerida pelo Codex instalado. Versão observada:
`codex-cli 0.162.0-alpha.17.2`. Modelo resolvido pela configuração: `gpt-6.1-sol`.

O ensaio confirmou dois turnos concluídos, memória de um marcador sintético na
mesma conversa e um terceiro turno interrompido com confirmação do servidor:

```json
{"canary":"passed","model":"gpt-6.1-sol","first":"completed","context":"preserved","interrupt":"interrupted","assistantMessages":2,"origin":"codex","speaker":null}
```

A primeira tentativa revelou uma incompatibilidade no override de nomes MCP:
as aspas no segmento eram interpretadas como parte do nome. Corrigido para
`mcp_servers.NAME.enabled`, com nomes previamente validados. Os dois ensaios
seguintes passaram. A integração exige confirmação de thread efêmera, lista
vazia de ambientes e sandbox somente leitura sem rede antes de aceitar texto.

Todos os ensaios usaram diretórios temporários vazios criados pela Presence.
`spectree-workspace` e `sindy-agent` não foram usados como alvos de teste.

## Interface observada

No navegador integrado, a conexão mostrou o modelo local e permitiu enviar uma
pergunta sintética por Enter. A resposta apareceu e chegou a **Resposta concluída**.
Uma solicitação longa foi interrompida pelo botão; o estado só mudou para
**Interrompido** depois da confirmação. Encerrar limpou a conversa e desabilitou
o compositor. A versão final foi novamente conectada e respondeu à pergunta.

- Desktop: largura 1265 px sem overflow horizontal.
- Viewport móvel: 390 × 844, largura útil e scroll de 375 px, sem overflow.
- Canvas sem energia de áudio e sem falante atribuído durante a conversa textual.
- Nenhum warning/error registrado pelo navegador na verificação final.
- Capturas locais: `presence-p2-desktop.jpg` e `presence-p2-mobile.jpg` no diretório
  de artefatos desta conversa. A captura desktop usa a versão final; a móvel
  antecede os últimos ajustes de texto/estado offline, sem alteração de layout.

## Limites e próximos passos

Esta é uma conversa textual local e efêmera, ainda sem ações no runtime,
microfone, voz ou delegação real. O renderer aprovado foi reaproveitado; texto
não simula amplitude de fala. A demonstração P1 continua disponível separadamente.

A compatibilidade foi comprovada com a versão local do Codex indicada acima.
Campos experimentais de ambientes podem mudar; incompatibilidade deve encerrar
a conexão. Não houve matriz de outros navegadores, sistemas ou GPUs físicos.
Testes de rede/protocolo usam injeção de falhas; não constituem auditoria externa.

O histórico da Presence fica em memória; não existe retomada persistente nesta
P2. O provedor pode manter seus próprios metadados. A autenticação local desta
entrega não define a arquitetura de um serviço comercial hospedado. Consulte
[uso e fronteiras](../../../presence-codex.md).

Próximo portão: revisão da branch e autorização de merge. Depois, a P3 integra
voz com seleção de provedor e orçamento próprios, conforme o roadmap aprovado.

## Preparação do merge autorizado

Em 2026-10-15, o Founder autorizou o merge. A branch incorporou `origin/main`
em `bb0de9e`, preservando a atualização do README e a release 1.14.1. Pacote,
lockfile, manifesto do plugin e identificação do cliente Presence foram alinhados
em **1.15.0**, pois cada merge publica uma tag própria. O escopo funcional da P2
permanece o validado acima. A evidência final do candidato integrado, o merge e
a publicação devem ser consultados no PR e no workflow correspondente, sem
confundir a preparação com uma integração já concluída.
