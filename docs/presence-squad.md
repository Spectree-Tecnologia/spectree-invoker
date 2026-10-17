# Presence P4.1 — delegação textual

Backend em branch, sem merge. Os seis papéis estão no registro inicial:
Architect, Developer, Quality, Platform, Integration e TypeSafe. TypeSafe só é
elegível quando a configuração confiável do servidor o habilita para a stack;
o navegador não pode habilitá-lo. Nenhum papel recebe ferramentas ou acesso a
projetos nesta entrega. Cada consulta usa uma sessão Codex efêmera própria.

## Iniciar o canário

Na raiz do Invoker, com login ChatGPT já feito no Codex:

```powershell
node scripts/presence.mjs --codex --squad
```

Não é necessária chave de áudio. Se o executável Codex depender de configuração
local, use o mesmo `SPECTREE_CODEX_EXECUTABLE` da P2. Não copie credenciais para
requisições. A URL impressa contém o token local da sessão e não deve ser compartilhada.

P4.1 disponibiliza uma API de texto. A tela existente ainda não inicia consultas
a especialistas; personagens e áudio dos subagentes pertencem à P4.2–P4.3.
`--squad` recusa `--voice`, `--realtime` e orçamento de áudio nesta etapa.
O serviço não abre projetos consumidores.

## Contrato local

Todas as rotas exigem `Authorization: Bearer <token-local-da-URL>`. Mutações também
exigem `Origin` igual à origem do servidor e `Content-Type: application/json`.
O token local não é uma chave OpenAI. Evite histórico de terminal ou logs com tokens.

1. `GET /presence/api/snapshot` obtém a sessão atual.
2. `POST /presence/api/action` com `action: "connect"`, `sessionId` e um
   `requestId` novo conecta o Invoker pelo harness; use o novo `sessionId` retornado.
3. `POST /presence/api/squad/action` admite uma consulta:

```json
{
  "action": "delegate",
  "sessionId": "<sessao-atual>",
  "requestId": "<uuid-novo>",
  "role": "full_stack_developer",
  "context": {
    "question": "Avalie os limites de um módulo de catálogo fictício.",
    "facts": ["Canário sem arquivos ou rede."],
    "constraints": ["Nenhuma implementação nesta consulta."],
    "acceptanceCriteria": ["Indicar hipóteses e verificações necessárias."],
    "openQuestions": []
  }
}
```

Resposta HTTP 200 significa **admissão**, não conclusão. Use
`GET /presence/api/squad/snapshot` para acompanhar `admitted`, `running`,
`cancelling`, `completed`, `cancelled` ou `failed`. O polling mantém o lease
de contato. A sequência e o snapshot completo permitem ressincronizar sem
reexecutar consultas. Não existe retry automático.

`POST /presence/api/squad/action` com `action: "cancel"`, `sessionId`, novo
`requestId` e `delegationId` aguarda o cancelamento. Desconectar/reconectar o
Invoker cancela a consulta antes da mudança. Encerrar o servidor fecha suas sessões.
Uma consulta ativa bloqueia outro envio ao Invoker; os dois usam o mesmo domínio
de IDs de requisição no HTTP, evitando redispatch por troca de endpoint.

No backend, `createPresenceSquad().executeTool()` aceita o nome
`delegar_subagente` e argumentos `role`/`context`, com a mesma validação e
deduplicação. Seu descritor está em `config().tool`. A função ainda não é anunciada
à conversa Realtime: isso depende da coordenação de fala das próximas etapas.

## Limites e autoria

- Uma consulta ativa por vez, até 16 por sessão; prazo máximo de 40 s.
- Cancelamento espera confirmação terminal por até 10 s; depois desconecta
  somente a sessão proprietária. ACK de interrupção não é conclusão.
- Contexto até 4.000 caracteres, JSON normalizado; saída até 6.000, com
  `recommendation`, `assumptions`, `openQuestions` e `publicUtterance`.
- Sessão, papel, instância e delegação são atribuídos pelo servidor. IDs privados
  do harness e raciocínio interno não entram no snapshot de delegação.
- Consultas usam inferência da assinatura Codex; não há chamadas de áudio pago.
  A possibilidade de consultar Quality ou Platform não comprova testes ou deploys.

Integração programática: `startPresence({ squad: true, typesafeEnabled: true })`
habilita TypeSafe somente quando o operador já confirmou a stack aplicável.
Isso não fornece API, ferramenta, rede ou credencial TypeSafe ao agente.

Veja [proposta](changes/presence-dialogo-squad/proposal.md),
[tarefas](changes/presence-dialogo-squad/tasks.md) e
[evidências e limitações](changes/presence-dialogo-squad/verification.md).
