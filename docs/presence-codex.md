# Presence P2 — conversa local com Codex

A [P3 de voz opcional](presence-voice.md) está em desenvolvimento em branch
própria. O modo `--codex` descrito aqui continua funcionando sem API de áudio.

Esta etapa conecta o personagem aprovado a uma conversa real **por texto**.
Não conecta microfone, sintetiza voz, delega especialistas nem executa tarefas
do runtime. A animação nunca representa aprovação de gates.

## Abrir

Na raiz do spectree-invoker, com as dependências instaladas:

```powershell
npm ci --ignore-scripts
codex login
npm run presence -- --codex
```

Se já estiver autenticado com sua conta ChatGPT no Codex, não precisa repetir
o login. Abra o endereço completo impresso, inclusive `#session=...`, e clique
em **Conectar Codex**. O token desse endereço é uma credencial efêmera da
interface local; não é o token da sua conta. Não compartilhe esse endereço.
Para uma porta fixa: `npm run presence -- --codex --port 4319`.

Escreva a mensagem e pressione Enter; Shift + Enter quebra a linha. A resposta
aparece progressivamente. **Interromper** aguarda a confirmação do Codex antes
de marcar o turno como interrompido. **Encerrar sessão** encerra o processo e
limpa a projeção local. A reconexão cria uma conversa nova.

`npm run presence` continua abrindo a demonstração P1 com vozes gravadas.
Os dois modos não compartilham sessões. O launcher da Console não muda.

## Sessão e autenticação

O processo `codex app-server --listen stdio://` mantém a autenticação oficial
local. A Presence consulta `account/read` e aceita somente `type=chatgpt`;
contas por chave de API não são usadas como alternativa. O aplicativo não lê
arquivos de credenciais, não implementa refresh de tokens e não expõe email,
plano, stderr ou respostas brutas de autenticação no navegador. O uso de texto
consome os limites da conta. Não há contratação de provedor de áudio nesta etapa.

O modelo é resolvido pelo Codex instalado a partir da configuração do usuário e
informado na interface. O canário desta implementação usou `gpt-6.1-sol`; isso
não constitui garantia de acesso a esse modelo para outras contas.

O contrato foi inspecionado com `codex-cli 0.162.0-alpha.17.2`, incluindo o schema
gerado pelo executável. A seleção explícita de ambientes é experimental. O
cliente negocia essa capacidade e exige que a resposta confirme thread efêmera,
nenhum ambiente, sandbox read-only sem rede, reviewer user e approvalPolicy never.
Uma versão incompatível é recusada; não há fallback para permissões mais amplas.

## Isolamento da P2

- Um diretório canário vazio é criado por sessão no temporário do sistema.
  Não há argumento de projeto, seletor de cwd ou abertura de consumidores.
- Sem ambientes de execução; shell, apps, plugins, memória, agentes adicionais,
  navegação, computador e web search são desabilitados para esse processo.
  MCPs da configuração efetiva são desabilitados antes de iniciar a thread.
- Hooks ativos detectados e nomes MCP incompatíveis com o override são recusados.
  Configurações geridas mais restritivas não são alteradas para forçar compatibilidade.
- Solicitações iniciadas pelo servidor, inclusive aprovações e elicitações,
  não recebem autorização: a sessão é encerrada. Eventos de ferramentas inesperados
  também encerram a sessão. Este transporte não é um endpoint genérico de RPC.
- Só mensagens `agentMessage` públicas são projetadas. Raciocínio interno, argumentos
  de ferramentas e eventos de outras threads/turnos são descartados.
- O canário vazio é removido quando possível, sem exclusão recursiva. Se o Codex
  produzir arquivos nele, o diretório é preservado. O Codex pode manter metadados
  operacionais próprios; a Presence não promete apagar os registros do provedor.

O modo de autenticação app-server usado aqui é local/pessoal. A documentação
oficial diferencia isso de serviços comerciais hospedados e recomenda a evolução
para Sign in with ChatGPT. Hospedar a Presence para outros clientes exige uma
etapa própria de autenticação e distribuição.

## Transporte e recuperação

O navegador consulta snapshots completos a cada 500 ms. Cada snapshot tem origem,
sessão e revisão; respostas atrasadas não sobrescrevem uma revisão mais nova.
Eventos JSONL do Codex alimentam a projeção; um delta não equivale a conclusão.
Somente `turn/completed` com `completed` significa sucesso. Fala e energia de
áudio ficam sempre vazias/zero na P2.

Há um turno ativo por sessão. Cada mutação usa um ID de requisição; repetição
idêntica não envia outro turno, e reaproveitamento com outro corpo é recusado.
O cliente não repete mutações após erros de rede. Ao perder contato, **Verificar
conexão** apenas busca o estado atual; não reenvia a mensagem. Se a resposta ao
envio se perder, confira a conversa antes de decidir por um novo envio.

Sem contato autenticado por 45 segundos, o processo é encerrado na próxima
verificação, em até mais 5 segundos. Fechar a página
tenta encerrar imediatamente; o prazo funciona como alternativa. Uma aba oculta
pode ser suspensa pelo navegador e expirar. Retomar não reenvia nem reinicia turnos.

Limites: 8.000 caracteres de entrada, 32.000 por mensagem de saída, 100 mensagens,
200.000 caracteres de histórico, 40 turnos, 256 IDs de operação por servidor,
30 s por RPC, 180 s por turno e 10 s para confirmar interrupção. Conversas são
efêmeras; a recuperação persistente fica fora desta entrega. Reinicie o servidor
quando atingir o limite de operações.

HTTP usa apenas loopback, Host/Origin e Bearer, corpo limitado e rotas fixas.
Texto é inserido com `textContent`. Não há Markdown/HTML executável nem downloads.
CSP e Permissions Policy preservam o bloqueio de câmera, microfone e frames.

## Verificar

```powershell
node --test tests/presence*.test.mjs
npm run check
# Opt-in: consome a sessão real do Codex, em canário próprio.
node scripts/presence-canary.mjs --live
```

O último comando verifica dois turnos com memória de um marcador sintético e
uma interrupção confirmada. Não faz parte do CI. Evidências e limites ficam em
[verificação P2](changes/presence-sessao-codex/verification.md).

Referências oficiais consultadas em 2026-10-14:
[App Server](https://learn.chatgpt.com/docs/app-server) e
[Configuration Reference](https://learn.chatgpt.com/docs/config-file/config-reference).
