# P4 — incrementos e condições de avanço

Esta branch entrega o planejamento. Itens de implementação permanecem abertos;
não são tarefas já executadas nem comandos disponíveis. A versão fica em 1.16.0.

## Planejamento

- [x] Verificar base integrada P3-R e limitações do código atual.
- [x] Definir identidade, perfil conversacional, contexto e retorno do Architect.
- [x] Definir direito de fala, cancelamento, limites e cenários de aceite.
- [x] Atualizar roadmap e registrar verificações sem API paga.

## P4.1 — delegação verificável, sem áudio pago

- [ ] Criar perfil fixo Architect de Presence e sessão Codex proprietária;
  preservar defaults e isolamento da sessão Invoker existente.
- [ ] Implementar coordenador e envelope público versionado, com deduplicação,
  estados de trabalho e correlação privada de sessão/chamada/turno.
- [ ] Validar entrada/retorno e impedir consultas genérica e especializada duplicadas.
- [ ] Testar admissão, erro, timeout, interrupção antes/depois do ACK, troca de
  sessão e resultado atrasado com RPC falso; mapear A1–A4, A7–A9 e A12.
- [ ] Provar por testes que o perfil não habilita ferramentas ou acesso a projetos.

Saída: resultado textual atribuível ao Architect, com evidência de despacho e
cancelamento. RPC falso deve ser identificado como simulado. Sessão real de
assinatura, se usada posteriormente, precisa de registro separado de compatibilidade.

## P4.2 — duas presenças e um direito de fala

- [ ] Acrescentar ativação opt-in e projeção do Architect real em `live.mjs`;
  reutilizar Three.js e preservar demo e modos existentes.
- [ ] Implementar player/arbitragem para saída nativa e síntese do especialista.
  Testar primeiro com fixtures locais, sem chamar TTS ou Realtime pagos.
- [ ] Confirmar barreira de áudio, controle de resposta automática, limpeza nativa
  e retomada; testar usuário interrompendo em cada fronteira, inclusive ACK tardio.
- [ ] Associar energia, legenda, fala parcial e término ao player correto;
  cobrir A5–A6, A8–A10 e A12 com áudio fixture e ensaio no navegador.
- [ ] Revisar teclado, movimento reduzido, fallback gráfico e descarte de recursos.

Saída: comportamento das duas presenças demonstrado como fixture, sem alegar
execução real. Sem barreira comprovada não avançar para áudio pago.

## P4.3 — integração de áudio e aceite limitado

- [ ] Integrar síntese `cedar` somente a retorno público validado; uma por consulta.
- [ ] Unificar reserva Realtime/TTS e preservar contabilidade entre reinícios;
  cobrir A11 e falhas/cancelamentos sem estorno fictício.
- [ ] Executar regressão proporcional e `npm run check` antes da revisão final.
- [ ] Apresentar ensaio concreto e obter orçamento adicional antes de API paga.
- [ ] Executar canário integrado com contexto fictício, medindo latência,
  atribuição, interrupção e fechamento; não acessar consumidores.
- [ ] Obter aceite físico de timbres, conversa e interrupção do Founder.
- [ ] Registrar evidência, riscos restantes e recomendação; merge separado
  requer autorização específica. Preparar versão somente na entrega integrada.

Dependências: P4.1 → P4.2 → P4.3. Persistência de conversas e recuperação automática,
expansão para outros especialistas e execução em projetos ficam para ciclos seguintes.
