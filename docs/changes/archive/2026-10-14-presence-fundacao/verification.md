# Presence P1 — registro de verificação

Data: **2026-10-14**, horário do cliente America/Fortaleza.
Branch: `codex/presence-fundacao`. Esta é a validação da fundação demonstrativa;
não certifica voz em produção, integração com harness nem comportamento de agentes.

## Implementação verificada

- Comando dedicado `npm run presence`, sem argumento de projeto.
- Personagem aprovado portado para Three.js local, Invoker branco e três paletas
  iniciais, olhos relativos ao cursor, estados textuais e expressões discretas.
- Reprodução Invoker → Architect → Invoker e envelope calculado no áudio
  efetivamente reproduzido; nenhum áudio de agente real ou microfone.
- Sessão efêmera com identidade, origem, ordem, participante em foco e falante.
- Cleanup de mídia e renderização, fallback estático, movimento reduzido e pausa.

## Testes automatizados

Na implementação inicial, os **14 testes de Presence** passaram, incluindo controles negativos:
identidade/origem incorreta, evento antigo, lacuna de sequência, falante não
admitido, troca indevida de falante, cancelamento durante `AudioContext.resume`,
pausa entre turnos, reset com especialista enfileirado, promessa de reprodução
obsoleta, erro de áudio e descarte idempotente. Os testes HTTP verificam as rotas
locais, CSP, bloqueio de mutações/origens e preservação da autenticação da Console.

A primeira suíte completa teve **409/410 passando**. O teste existente
`the other ordering too: a reopening that COMPLETED under the barrier refuses the decision`
falhou por ausência de `barrier.json` após aproximadamente 62 s. Repetido
isoladamente, passou em aproximadamente 6 s. Não houve mudança no mecanismo de
concorrência para obter esse resultado. A causa da variação não foi estabelecida;
um resultado verde posterior não apaga essa observação.

A repetição integral de `npm run check` passou: **410/410 testes**, zero falhas,
cancelamentos ou skips, em aproximadamente **273,5 s**. Drift dos artefatos gerados
e integridade do plugin também passaram. Os testes específicos foram repetidos
após o ajuste final de atribuição de participante e passaram; sintaxe dos módulos,
links da documentação e `git diff --check` foram verificados.

## Inspeção no navegador

Ambiente: Codex In-app Browser no Windows 10.0.26200, Intel Core i5-13450HX,
16 processadores lógicos e 16 GiB de RAM; GPU não identificada nesta inspeção.
Viewport desktop de 1265 × 720 sem override; teste estreito com override de 390 × 844,
resultando em largura útil de documento de 375 px com a barra de rolagem.
Não equivale a ensaio em celular físico.

| Cenário | Observação |
|---|---|
| Reprodução | Interface e canvas identificaram Invoker e Architect durante seus turnos; amostra de fala do Invoker RMS 0,0863 / energia 0,6585. |
| Repouso | Sem áudio, energia observada 0,0000; após pausar movimento, contador permaneceu em 729 quadros entre inspeções separadas. |
| Olhar | Clique/movimento na área direita da cena levou `data-gaze` a 0,160; expressão acompanhou o cursor. |
| Visibilidade | Navegação para os estados abaixo da cena deixou seu limite inferior em −23 px; áudio pausado e estado disponível, sem retomada automática. |
| Teclado | Enter no botão de transcrição abriu o texto completo dos três turnos. |
| Responsividade | Documento e scrollWidth ambos 375 px; controles e texto sem transbordamento horizontal. |
| Paletas | Oito alternâncias entre as quatro identidades mantiveram recursos estáveis após a entrada do segundo personagem. |
| Console do navegador | Nenhum erro ou aviso observado na consulta durante o ensaio. |

Depois de compartilhar as geometrias entre os personagens: **8 geometrias,
5 texturas, 7 programas**, DPR **1**, e **p95 16,8 ms** na janela de 600 intervalos
ativos. Dentro do orçamento P1 documentado (33,4 ms / 10 geometrias / 6 texturas /
10 programas). Os contadores são de recursos WebGL, não consumo total em bytes
de memória nem custo do backend. A janela exclui suspensão; não mede latência
entre microfone e resposta.

O port também removeu artefatos visuais dos shaders do estudo: operações
indefinidas de potência/smoothstep e disputa de profundidade dos véus.

## Limites da validação

- Preferência de movimento reduzido, perda de contexto, ausência de WebGL e
  reconstrução por cache agora têm testes determinísticos descritos abaixo.
  Não foram induzidas falhas físicas de GPU nem alterada a preferência do sistema.
- Cleanup de áudio e de recursos Three.js foi exercitado por testes. A liberação
  física de memória da GPU e o comportamento real do cache do navegador permanecem
  fora dessa evidência: o navegador bloqueou a navegação de saída do ensaio de
  histórico (`ERR_BLOCKED_BY_CLIENT`); não foi usado um caminho alternativo para
  contornar esse bloqueio.
- Faltam ensaios em outros navegadores e hardware. A integração foi comparada
  visualmente ao estudo aprovado, com capturas desktop e mobile preservadas
  nos artefatos da conversa (`presence-p1-desktop.jpg` e `presence-p1-mobile.jpg`).
- A falha de concorrência na primeira suíte deve permanecer visível na revisão.
- Não há merge, release, publicação ou teste em `spectree-workspace`/`sindy-agent`.
  Codex real, microfone e provedores de voz continuam nas etapas P2/P3.

P1 está implementada e disponível para revisão local. Este registro não recomenda
merge automático nem declara cumpridas as inspeções ainda pendentes acima.

## Complemento — retomada e recursos

Na continuação da P1, em 2026-10-14, foram corrigidos:

- Reutilização dos elementos de áudio/canvas após descarte, no retorno por cache.
  A reconstrução agora cria elementos novos e restaura textos e controles iniciais.
- Fallback com canvas e métricas da cena antiga ainda presentes. A falha encerra
  recursos, oculta o canvas e remove os contadores obsoletos.
- Inicialização em hardware sem `EXT_color_buffer_float`: recusa controlada antes
  de construir a cena, mantendo áudio e transcrição.
- Duas expressões restantes de shader com potência de base potencialmente negativa:
  os quadrados agora usam multiplicação, preservando a forma visual.

Foram acrescentados **6 testes**, totalizando **20 testes específicos passando**.
Eles usam geometrias, materiais, texturas e render targets reais do Three.js, com
substituição do driver de GPU, agenda de quadros e eventos do navegador. Verificam
quadro estático sob movimento reduzido, alteração da preferência, suspensão fora
da tela, descarte único de recursos compartilhados, falhas de inicialização,
reconstrução idempotente da sessão e troca dos elementos ligados ao áudio.
Isso comprova a chamada de descarte e o fim do agendamento; não mede o driver físico.

Recarregamento no navegador confirmou a reprodução do Invoker e ausência de erros
ou avisos no console após a extração do núcleo. A demonstração terminou com energia
zero e nenhum falante ativo. Os recursos permaneceram em 8 geometrias, 5 texturas
e 7 programas, com p95 de 16,8 ms na janela de 600 intervalos. A captura final foi
preservada em `presence-p1-lifecycle.jpg` nos artefatos da conversa.

`npm run check` desta continuação passou: **416/416 testes**, zero falhas,
cancelamentos ou skips, em aproximadamente **286,8 s**. Drift dos artefatos gerados
e integridade do plugin também passaram. Esse resultado não elimina a ocorrência
intermitente histórica registrada acima nem as limitações do ensaio de navegador.

## Preparação do merge autorizado

Após o GO do Founder, a branch incorporou `origin/main` em `ff3ad2e`, preservando
a licença MIT, o guia de contribuição e os templates adicionados em paralelo.
O pacote, o lockfile e o manifesto do plugin foram alinhados em **1.14.0** para
publicar a fundação demonstrativa P1 sem reutilizar a tag 1.13.0. P2/P3 permanecem
planejadas. As checagens locais de drift e integridade passaram novamente.
O resultado do CI do candidato integrado e da publicação deve ser consultado no PR
e no workflow do commit de merge; os 416 testes acima são a evidência local prévia.
