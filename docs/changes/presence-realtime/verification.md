# Verificação — Presence Realtime

2026-10-16 · branch `codex/presence-realtime`, baseada na P3 ainda não integrada.
Founder confirmou a base manual e escolheu voz nativa Realtime com ponte Codex.
Autorizou elevar o teto total dos ensaios OpenAI de US$ 2 para US$ 5.
Não há autorização de merge desta entrega.

## Implementação

WebRTC contínuo, bootstrap pelo servidor, gpt-realtime-2.1, voz marin, semantic
VAD, interrupção de fala, playout nativo com RMS, legendas públicas e ponte
`consultar_codex` via app-server autenticado. A ponte permanece em canário
isolado e conversacional. Nenhum consumidor foi usado como alvo.

Controles de conversa, seleção do notebook, descarte de resultados antigos,
deduplicação de função, limites de tempo/contexto/saída e encerramento pelo
servidor. Dependência `ws` fixada em 8.22.0, instalada sem scripts; npm reportou
zero vulnerabilidades na instalação. Isso não é auditoria de segurança completa.

## Canários reais

1. Conexão e deadline: WebRTC/sideband abertos; uma corrida na fixture impediu
   iniciar sua mídia. O servidor encerrou aos 60 s, com hangup confirmado e zero
   tokens observados. Cliente corrigido para esperar o canal RTC abrir.
2. Canário de 15 s: resposta nativa e análise iniciadas, interrompidas pelo
   limite antes do resultado. 559 tokens de entrada e 238 de saída observados.
   Não creditado como validação da análise concluída ou RMS audível.
3. Canário completo, após ajuste de playout: fala demonstrativa sem microfone
   físico; resposta nativa com **energia máxima 1,0000**. Nova fala durante a
   saída produziu **uma interrupção observada**. A consulta Codex concluiu; o
   Invoker falou dois critérios de aceite para uma lista de tarefas e voltou a
   escutar. Uso observado: **2.846 tokens de entrada e 871 de saída**. Botão
   encerrou os dispositivos. Ajustado o fechamento para manter o controle até
   hangup e distinguir recurso já encerrado de confirmação ausente.
4. Canário final de fechamento, 15 s: encerramento local seguido de estado remoto
   **already-ended**; zero tokens observados. Nenhuma nova chamada após esse teste.

Captura `presence-realtime-canary.png` nos artefatos desta conversa registra
energia, interrupção e análise confirmada. Dados sintéticos; nenhum microfone
físico foi ligado. O Founder validou seu microfone no modo manual anterior.

Reservas Realtime: US$ 1 + US$ 0,30 + US$ 1 + US$ 0,30 = **US$ 2,60**. Somadas
às reservas conhecidas anteriores US$ 0,70: **US$ 3,30**, saldo conservador
**US$ 1,70** do teto US$ 5. Sem consulta ao extrato ou afirmação de custo faturado.

## Testes

**62/62 testes Presence passaram**, incluindo nove Realtime: configuração,
segredo isolado, orçamento/deduplicação/cancelamento, execução única da ponte,
invalidação por fala, deadline sem cliente, full duplex/interrupção, readiness
RTC, permissão tardia e HTTP autenticado. Nenhum usa a API paga.

A primeira suíte ampla teve **455/456 passando**; o benchmark recusou medição
mista porque o pacote estava sendo editado durante a execução. Essa proteção
não foi desabilitada. A primeira execução não é creditada como verde.

Repetição final com árvore estável: **`npm run check` aprovado, 458/458 testes**,
zero falhas, cancelamentos ou skips, em 333.214 ms. `check:drift` e
`check:plugin` também aprovados. Depois da suíte, apenas este registro de
evidência foi atualizado; nenhum código mudou.

Interface operacional conectada ao Codex local e pronta para **Iniciar
conversa**, com reserva US$ 0 / US$ 1,70. Captura
`presence-realtime-ready.png` nos artefatos desta conversa. Nenhuma chamada paga
foi iniciada nessa interface. Servidores e abas temporários dos canários foram
encerrados. `.env` ignorado e não rastreado pelo Git.

## Pendências

Aceite Realtime com o microfone físico do Founder, latência percebida em conversa
prolongada e matriz de dispositivos/navegadores. Sessões de 60 s são ensaios, não
configuração de produção. Execução em projetos e especialistas ficam nas etapas
posteriores. Nenhum merge realizado.

## Correção de preparação do microfone após o primeiro aceite

O Founder informou `E_MIC_PERMISSION` ao escolher o microfone, antes de iniciar
a conversa. A enumeração já exibia o Realtek, mas nomes disponíveis não provam
permissão para abrir a captura. O fluxo agora verifica a entrada explicitamente
selecionada sem abrir o USB padrão, para as trilhas imediatamente e mantém a
seleção. Trocar de entrada limpa o erro anterior. Falhas de reprodução e de
acesso ao microfone têm códigos distintos; a solicitação de microfone Realtime
não espera a reprodução para iniciar no gesto do botão.

Na interface real do navegador integrado, selecionar **Grupo de microfones
(Realtek(R) Audio)** e clicar **Escolher microfone** concluiu a verificação local
sem erro e preservou a seleção. Nenhuma conversa paga foi iniciada pelo agente
nesta correção. Captura `presence-microphone-realtek-verified.png` nos artefatos
da conversa. Isso comprova abertura local, não qualidade do sinal ou conversa
completa pelo microfone físico.

Durante a interação do operador, o servidor registrou mais US$ 1 de reserva e
encerramento remoto **confirmed**. Total conservador conhecido agora:
**US$ 4,30 de US$ 5**, saldo **US$ 0,70**; sem afirmação de custo faturado.
O servidor foi reiniciado na mesma origem com apenas esse saldo. A interface
bloqueia novo ensaio de US$ 1 e continua permitindo a configuração local.

Após esses ajustes: **65/65 testes Presence**, `check:drift` e `check:plugin`
aprovados. Três casos novos verificam solicitação no gesto, reprodução recusada
sem falsa negação de microfone e tentativa explícita após permissão recusada.
O teste de configuração também verifica a abertura exata e liberação imediata
do dispositivo selecionado. Uma execução inicial dentro do sandbox recusou o
loopback; a repetição com acesso local passou. A suíte ampla de 458 testes é
a evidência do commit anterior; não foi repetida para esta correção de cliente.

## Novo ensaio autorizado

Em 2026-10-16, o Founder escolheu explicitamente **ampliar o teto total para
US$ 6 e liberar outro ensaio de 60 segundos**. As reservas anteriores conhecidas
permanecem US$ 4,30; saldo conservador US$ 1,70. A Presence foi reiniciada na
mesma porta com esse saldo. Nenhuma chamada paga foi iniciada pelo agente para
essa liberação; a conversa é iniciada pelo operador no botão da interface.
Nenhuma autorização de merge foi inferida dessa decisão.

## Aceite do Founder

Em 2026-10-16, depois de executar o ensaio com seu microfone físico, o Founder
confirmou: **"Otimo funcionou perfeitamente"**. Esse é o aceite da experiência
P3-R; não é autorização de merge nem medição de latência ou matriz de hardware.

A consulta somente de metadados ao servidor encontrou reserva US$ 1 de
US$ 1,70, término por **E_REALTIME_TIME** (deadline previsto de 60 segundos) e
hangup **confirmed**. O conteúdo da conversa não foi copiado para este registro.
Reservas conhecidas acumuladas: **US$ 5,30 do teto US$ 6**, saldo **US$ 0,70**;
valor faturado não consultado. Nenhuma nova chamada foi iniciada pelo agente.

O aceite físico está concluído. Permanecem a revisão para integração, a
autorização de merge e as validações futuras de uso prolongado/produção e
especialistas. Esta atualização é documental; código e evidências de testes
do commit `b936730` permanecem os mesmos.

## Correções da revisão autorizadas pelo Founder

O Founder autorizou corrigir os dois achados P2 da revisão do commit `50a25f1`.
Antes da correção, cinco regressões novas falharam e reproduziram cancelamento
antes do ACK de início, timeout da análise, cancelamento não confirmado e
encerramentos concorrentes. Nenhuma usou a API paga.

A análise agora conserva sua propriedade até estado terminal ou desconexão da
sessão correspondente. Um cancelamento solicitado antes do ACK é aplicado
quando o turno fica interrompível. O ACK da RPC de interrupção não é tratado
como término. Após até 10 s sem confirmação, a sessão é desconectada, sem
atingir uma sessão substituta. O estado público inclui `cancelling`.

O encerramento agora conserva um proprietário até concluir em paralelo a
limpeza Codex e o hangup. Novos starts são recusados antes de reservar orçamento
durante essa espera. End/stop repetidos aguardam o mesmo resultado. A publicação
final exige a mesma chamada e geração; uma confirmação antiga não pode
reescrever o estado de outra chamada.

**71/71 testes Presence aprovados**, incluindo seis novas regressões (as cinco
originais e a preservação de sessão substituta).

Regressão completa concluída em **2026-10-17** com árvore estável:
**`npm run check` aprovado, 467/467 testes**, zero falhas, cancelamentos ou skips,
em 445.289 ms. `check:drift` e `check:plugin` também aprovados. Depois da suíte,
apenas este registro de evidência e o roadmap foram atualizados; nenhum código
mudou. A revisão das correções não encontrou outro bloqueio no escopo analisado.

Não houve novo ensaio pago, acesso a consumidores ou merge. O aceite físico
anterior continua registrado. **Recomendação: seguir para o merge desta P3-R**,
respeitando os checks da integração e a autorização específica do Founder.

## Preparação do merge autorizado — 2026-10-17

O Founder aprovou a recomendação de merge. A candidata incorpora `origin/main`
em `104f709`, preservando as correções de escrita atômica e digest CRLF no
Windows, a descrição do runtime e a remoção de dados pessoais. O conflito no
README foi conciliado preservando essa descrição e os novos modos de voz.

Pacote, lockfile, manifesto do plugin e identificação do cliente Presence foram
alinhados em **1.16.0**: cada merge na main publica uma tag própria. Nenhum novo
ensaio pago foi executado. O resultado do candidato integrado, a integração e
a publicação pertencem aos checks do PR e ao workflow do commit de merge;
esta preparação não os declara concluídos.
