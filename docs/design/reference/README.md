# Fonte do estudo aprovado

`spectree-characters.js` preserva a fonte do estudo aprovado pelo Founder antes
da integração. É uma referência histórica, não um entrypoint distribuído ou
carregado pelo Presence. O marcador de áudio não contém as gravações incorporadas
ao HTML original. Referências ao ambiente da conversa e ao CDN pertencem ao estudo.

A implementação está em `presence/renderer.mjs`, com shaders e geometria derivados
deste arquivo, separação de estados/áudio, carregamento local e descarte explícito.
O teste visual da integração identificou artefatos no contorno dos véus. O port
elimina operações indefinidas nos shaders (`pow` com base negativa e `smoothstep`
com limites invertidos) e compõe o contorno aditivo sem disputa de profundidade.
Tamanho 0,72, intensidade 1,0, olhos e paleta permanecem como aprovados.

Os três arquivos em `presence/audio/` são as vozes sintéticas gravadas para o
estudo local (Maria/Daniel, sintetizador do Windows), copiadas sem alteração de
`lumen-voice-0.mp3`, `lumen-voice-1.mp3` e `lumen-voice-2.mp3`. Não são vozes de
agentes executando nem material coletado de conversas reais. A transcrição
correspondente está na interface.

Three.js 0.180.0 é instalado pelo npm, com licença MIT e integridade registrada no
lockfile. A licença acompanha o pacote em `node_modules/three/LICENSE`.
