# Presence — fundação visual e estados

Primeira entrega do [ciclo 1.14](../../../ROADMAP.md), na branch
`codex/presence-fundacao`, aberta após autorização do Founder em 2026-10-13.
Estado em 2026-10-14: implementação local realizada após GO do Founder; evidências
e limites de aceite em [verification.md](verification.md). Sem merge ou release.

## Problema e resultado esperado

A Console atual mostra registros do runtime. A experiência aprovada exige uma
presença conversacional: personagem com identidade, olhar e expressão ligada
à fala. Hoje esse comportamento existe apenas em um estudo da conversa.

Esta entrega deve disponibilizar uma superfície local de demonstração com o
personagem aprovado e um contrato de estados reutilizável pela futura sessão.
O usuário deve conseguir observar o Invoker e um especialista, reproduzir áudio
demonstrativo e distinguir claramente o que está sendo simulado.

## Escopo

1. Portar a [referência aprovada](../../../design/presence.md) para um componente
   Three.js do repositório, com recursos locais e versões de dependências fixadas.
   Definir a estratégia de distribuição antes de adicionar dependências: a
   Console hoje usa módulos nativos sem bundler.
2. Criar uma superfície Presence separada da navegação de observabilidade,
   reutilizando as proteções locais de sessão quando aplicável. Manter as APIs
   existentes da Console somente para leitura e sua política de origem restrita.
3. Definir e testar um redutor de estados com identidade do participante, origem
   do evento e limpeza de sessão. Preparar uma interface para os futuros adapters,
   sem fabricar eventos de execução real.
4. Reproduzir áudio demonstrativo por ação explícita, analisar seu envelope e
   sincronizar fala/olhos/luz com o áudio ouvido. Oferecer transcrição, pausa e
   indicação persistente de demonstração.
5. Tratar movimento reduzido, ausência/perda de WebGL, viewport pequeno,
   ocultação da página e desmontagem sem deixar áudio ou recursos ativos.

## Contrato a implementar

O envelope mínimo tem versão, `sessionId`, `participantId`, sequência monotônica
na sessão, tipo e origem (`demo` ou `session`). A origem é atribuída pelo produtor
de eventos confiável; um campo enviado pelo navegador não comprova execução.
O relógio visual pode interpolar movimentos, mas não produzir eventos de domínio.

| Estado | Entrada autorizada | Comportamento observável |
|---|---|---|
| Disponível | Inicialização ou fim do turno | Respiração discreta e olhar; sem indicação de microfone ativo. |
| Escutando | Evento de captura ativa; simulação rotulada em P1 | Atenção ao usuário; falha/encerramento da captura encerra o estado. |
| Processando | Turno aceito pela sessão; simulação rotulada em P1 | Expressão de espera, sem simular progresso do modelo. |
| Falando | Início da reprodução atribuída a um participante | Expressão baseada no áudio reproduzido; pausa, término e interrupção zeram a energia. |
| Delegando | Evento público de delegação; simulação rotulada em P1 | Entrada do especialista e indicação de atenção, sem inventar atividade. |
| Interrompido ou erro | Cancelamento/falha com motivo público | Áudio encerrado, mensagem legível e recuperação explícita. |

Rejeitar eventos desconhecidos, de outra sessão, repetidos ou fora de ordem.
Uma lacuna de sequência exige ressincronização pelo produtor antes de avançar;
o componente não deduz os eventos ausentes. Reset de sessão limpa os participantes,
a fila de áudio e o último estado. Estado de fala pertence ao participante cujo
áudio está sendo reproduzido, inclusive quando há outros participantes visíveis.
Os detalhes de transporte e persistência ficam para P2.

## Fora desta entrega

Autenticação ou transporte Codex/Claude, microfone real, escolha/contratação de
provedor de voz, execução de comandos, delegação real, retomada persistente e
instalação em projetos consumidores. A P1 não altera gates nem o protocolo gerado.

## Critérios de aceite

- Invoker branco e paleta inicial preservados, tamanho 0,72 e intensidade 1,0
  como baseline; comparação visual com o estudo aprovado em tela grande e pequena.
- Cada personagem olha para o cursor a partir de sua própria posição; há alternativa
  sem dependência de hover, animação ou percepção de cor.
- Áudio com trechos de fala e silêncio comprova reação ao sinal; pausas, fim e
  troca de participante não deixam outro personagem aparentando falar.
- Sequências determinísticas cobrem turno normal, cancelamento, erro, duplicação,
  evento atrasado, lacuna e reset; nenhum deles concede autorização de runtime.
- Demonstração é identificada em toda a jornada, sem alegar microfone ou agente ativo.
- Pausa, navegação por teclado, preferência por movimento reduzido e fallback de
  WebGL funcionam. Ocultar/desmontar encerra ou suspende reprodução e libera recursos
  conforme a política documentada, sem retomada inesperada de áudio.
- Recursos e Three.js são servidos localmente, sem relaxar CSP, origem ou autenticação
  para acomodar CDN. A Console e o instalador existentes continuam funcionando.
- Registrar navegador, dispositivo, tamanho da cena, tempo de quadros e consumo
  de recursos observado em ensaio repetível. Definir orçamento de desempenho
  antes do aceite técnico; não declarar metas atingidas sem medição.
- `npm run check` passa, e a evidência de teste de navegador distingue inspeção
  visual, validação automática e eventuais limitações do ambiente.

## Ordem de implementação nesta branch

1. Preservar a fonte aprovada no repositório com procedência e extrair o componente,
   removendo dependências dos controles da conversa.
2. Implementar o contrato e o redutor com cenários determinísticos.
3. Integrar a superfície local e a reprodução demonstrativa analisada.
4. Validar visual, acessibilidade, isolamento, recursos e regressões; registrar
   evidências e pendências antes de recomendar revisão/merge.

Testes com consumidores usam apenas canários descartáveis. `spectree-workspace`
e `sindy-agent` permanecem fora dos alvos de teste e escrita.
