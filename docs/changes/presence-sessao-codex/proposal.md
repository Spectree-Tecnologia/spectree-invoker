# Presence P2 — sessão Codex local

GO do Founder: continuar após o merge da P1 (#41 / v1.14.0).
Branch: `codex/presence-sessao-codex`. Não autoriza merge desta etapa.

## Escopo

Adicionar modo `npm run presence -- --codex`, separado da demonstração P1.
O servidor local cria um canário temporário próprio e conversa com o executável
Codex por JSONL/stdio. A autenticação permanece gerida pelo Codex; somente uma
conta ChatGPT já autenticada é aceita. Não ler, copiar ou transmitir arquivos de
credenciais. Sem fallback automático para cobrança por API.

Uma sessão efêmera, um turno ativo, texto incremental, interrupção e erros
explícitos. Somente mensagens públicas do assistente chegam à interface. Sem
raciocínio interno, comandos, microfone, voz sintética ou subagentes nesta etapa.
O Invoker permanece branco, com o renderer aprovado; texto não produz energia
de áudio nem estado de fala. Conversa não modifica gates do runtime.

## Contrato e fronteiras

- `initialize` / `initialized`, `account/read`, `thread/start`, `turn/start`,
  `turn/interrupt`; somente `turn/completed.status=completed` é sucesso.
- O contrato instalado é gerado pelo próprio `codex app-server generate-json-schema`.
  Campos experimentais de seleção de ambiente precisam ser negociados. Ausência
  ou incompatibilidade encerra a conexão; nunca relaxar permissões para funcionar.
- Thread sem ambientes, sandbox read-only, ferramentas e integrações desligadas.
  Solicitações de aprovação/ferramentas não suportadas encerram a sessão.
- HTTP apenas loopback; Host/Origin validados; token aleatório no fragmento da URL,
  usado como Bearer. API fixa, corpos limitados, IDs de sessão e de requisição.
  Nada de endpoint RPC genérico, cwd arbitrário ou token Codex no navegador.
- Projeção incremental por snapshots revisionados, consultados a cada 500 ms.
  Não reenviar automaticamente comandos. Perda de contato expira a sessão;
  reconexão precisa ser explícita. Reset/saída encerra o processo anterior.
- Histórico limitado em memória; sem recuperação persistente nesta P2.

## Aceite

1. Conversa real de dois turnos em canário com continuidade de contexto.
2. Resposta incremental, cancelamento confirmado, falha sem sucesso fictício.
3. Testes de duplicação, concorrência, saída do processo, timeout, sessão antiga,
   eventos de outro turno, dados privados, abuso de HTTP e solicitações de aprovação.
4. Interface por teclado, texto seguro (sem HTML injetado), estado sem áudio,
   fallback WebGL e demonstração P1 preservados.
5. `npm run check`, ensaio real e evidências com limites documentados.

Não testar ou escrever em `spectree-workspace` ou `sindy-agent`.
Login via app-server aqui é integração local pessoal; não define autenticação de
um serviço comercial hospedado. A documentação atual recomenda Sign in with
ChatGPT para essa evolução, que exigirá desenho separado.

Fontes consultadas em 2026-10-14:
- https://learn.chatgpt.com/docs/app-server
- https://learn.chatgpt.com/docs/config-file/config-reference
