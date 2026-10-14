# Spectree Presence — direção visual aprovada

Referência de implementação da P1 do [roadmap](../ROADMAP.md). A aprovação do
Founder cobre o personagem e as interações do estudo `spectree-characters.html`,
não uma integração de voz ou harness já implementada.

## Identidade a preservar

- Corpo arredondado e translúcido, contorno luminoso definido e halo discreto.
- Dois olhos luminosos em cápsula; olhar calculado em relação à posição de cada
  personagem, acompanhando o cursor sem deslocamentos exagerados.
- Piscadas breves, curiosidade sutil e atenção ao interlocutor.
- Invoker branco; Architect azul; Developer vermelho; Quality amarelo.
  As cores dos outros especialistas permanecem em aberto.
- Padrões aprovados do estudo: intensidade **1,0** e tamanho **0,72**. Esses valores
  são relativos aos controles do protótipo, não unidades físicas universais.
- Movimento reduzido, pausa e controle da reprodução disponíveis ao usuário.

Não usar os estudos anteriores de esfera giratória, logo literal ou toro como
baseline: foram substituídos pelo personagem aprovado.

## Tradução para o produto

Implementar a presença em Three.js/WebGL, com dependência fixada e servida
localmente. O protótipo usa uma importação por CDN e controles do ambiente da
conversa; essas dependências não constituem a arquitetura de produção.

A renderização recebe estado e características do áudio por interfaces explícitas.
Ela não inicia agentes, decide gates ou deduz atividade real a partir de um timer.
O envelope do áudio efetivamente reproduzido orienta a expressão durante a fala;
silêncio, pausa e término precisam se refletir imediatamente no personagem.

Uma descrição textual identifica personagem, estado e origem demonstrativa ou
real. Cor, brilho e movimento não são o único meio de comunicar atividade. Sem
WebGL, a superfície continua legível por uma representação estática e textual.

## Procedência e limites

O estudo aprovado e sua fonte estão nos artefatos locais da conversa:
`spectree-characters.html`, `spectree-characters.js` e
`spectree-presence-approved.md`. A localização desta sessão é
`C:/Users/gilso/.codex/visualizations/2026/09/27/01a0e2cc-4919-76e1-a74f-3b662dca9777/`.
Esses arquivos ainda não são componentes distribuídos pelo repositório.

O estudo incorpora vozes gravadas de demonstração. Não captura microfone,
não executa agentes e não está conectado ao harness. Houve aprovação visual
do usuário e verificação de sintaxe; isso não substitui a futura validação do
componente integrado no navegador.
