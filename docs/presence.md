# Spectree Presence — fundação local

P1 do [roadmap](ROADMAP.md): personagem Three.js, estados explícitos e conversa
demonstrativa Invoker → Architect → Invoker. O áudio é gravado; esta entrega
não captura microfone, conecta harness, executa comandos nem abre projetos.

## Abrir

Na raiz do **spectree-invoker**:

```powershell
npm ci --ignore-scripts
npm run presence
```

Abra o endereço `/presence/` impresso no terminal. A porta é livre por padrão;
para fixá-la, use `npm run presence -- --port 4319`. Encerre com Ctrl+C.
O launcher instalado da Console continua abrindo apenas a Console; o Presence
P1 roda a partir deste checkout e não é instalado em consumidores.

Clique em **Ouvir Invoker** para iniciar a demonstração. **Pausar voz** conserva
o ponto de reprodução; **Reiniciar** encerra áudio e limpa a conversa. As cores
Developer/Quality são prévias visuais e não têm turnos de voz nesta entrega.
Transcrição e estados simulados podem ser explorados por teclado.

## Arquitetura desta entrega

- `scripts/presence.mjs` inicia o servidor local existente em um modo dedicado,
  que recusa projetos e não expõe os endpoints de observação da Console.
- `presence/state.mjs` projeta eventos versionados e ordenados por sessão.
  Duplicatas, identidades desconhecidas e origens divergentes são recusadas;
  uma lacuna silencia a projeção e exige nova sessão confiável. O redutor é uma
  fronteira de consistência, não autenticação nem autorização de runtime.
- `presence/audio.mjs` controla reprodução, fila, pausa e descarte. Um
  `AnalyserNode` mede o PCM que alimenta a saída de áudio; silêncio e pausa
  produzem energia zero. Não há animação de fala fabricada por osciladores.
- `presence/renderer.mjs` recebe somente a projeção visual e o envelope de áudio.
  Renderiza o personagem aprovado, olhar relativo ao cursor e atenção ao falante.
- `presence/app.mjs` conecta a demonstração à interface. Só o evento de reprodução
  efetiva marca um participante como falando. A entrada do Architect é simulada
  explicitamente; nenhuma delegação real é alegada.

## Recursos e limites

Three.js **0.180.0** fica fixado no pacote e no lockfile. São servidos apenas
dois módulos do pacote, quatro módulos locais, HTML/CSS e três áudios por uma
lista explícita de rotas. Não há CDN, bundler, telemetria ou serviço externo na
execução. `npm ci` é necessário para instalar a dependência antes de iniciar.
O CI instala pelo lockfile antes dos testes.

O servidor escuta apenas em `127.0.0.1`, valida Host/Origin e recusa mutações.
A superfície demonstrativa não contém dados privados e não precisa da credencial
da Console. A Console mantém sua autenticação e CSP originais. A CSP do Presence
admite somente mídia local; a Permissions Policy desabilita microfone e câmera.

Ao ocultar a aba ou tirar a cena da área visível, a reprodução é pausada e não
retoma sozinha. A animação para fora da área visível. `pagehide` libera contexto
de áudio, listeners, observers e recursos WebGL; retorno via cache de navegação
cria uma nova sessão. Não há persistência de conversa em P1.

Movimento reduzido remove rotação, piscadas, seguimento do cursor e transições
de posição; a luz ainda indica áudio com intensidade reduzida. **Pausar movimento**
usa o mesmo caminho de renderização estática. Texto e transcrição permanecem
acessíveis sem WebGL; a perda de contexto encerra a cena e mostra o fallback.

## Orçamento e verificação

Meta local P1: p95 de intervalo entre quadros ativos ≤ **33,4 ms** em janela de
600 amostras, com até dois personagens e DPR limitado a 1,5. Limites de recursos:
até 10 geometrias, 6 texturas e 10 programas; trocas de paleta não devem aumentar
esses contadores. Isso é um orçamento da cena em um equipamento identificado,
não uma promessa para todo dispositivo nem medida de latência de voz.

O DOM registra métricas locais em `#presence[data-metrics]` e valores instantâneos
em `canvas[data-energy]`, `data-speaker` e `data-gaze`, para inspeção do ensaio.
Não são evidências de execução do squad. A janela exclui intervalos ≥250 ms
(suspensão); pausas prolongadas devem ser avaliadas separadamente, sem usar o
p95 para afirmar ausência de travamentos.

Validação automatizada: `node --test tests/presence.test.mjs`, seguida de
`npm run check`. Repetir no navegador: três turnos, pausa/retomada, reinício,
troca de identidade, transcrição por teclado, cena fora da tela e viewport
estreito. Resultados e limitações ficam no [registro de verificação](changes/presence-fundacao/verification.md).
