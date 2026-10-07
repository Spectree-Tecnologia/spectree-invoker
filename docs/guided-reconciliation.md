# Adoção e Reconciliação Operacional — ciclo 1.11

## Contrato

O diagnóstico informa a versão do runtime que o executa, a versão encontrada no caminho de instalação local, os comandos declarados e as divergências entre artefatos e estado. Não presume qual plugin outra sessão carregou. Nomes de scripts são pistas de inventário, nunca prova de sua semântica.

Uma mudança nova só usa `prepared` quando `closure.consolidate` está declarado. Sem esse mecanismo, o operador precisa escolher `legacy` explicitamente ou configurar o projeto. Nenhum script de consolidação é executado pelo diagnóstico.

A reconciliação deste ciclo corrige apenas o modo de fechamento de mudanças até `implemented`, inclusive bloqueadas a partir dessas etapas, antes de haver preparação ou recibo de integração. Não avança estado, arquiva, faz merge, cria evidência, cria aprovação ou desbloqueia automaticamente. Casos posteriores exigem os fluxos existentes de reabertura e confirmação; não são convertidos retroativamente em sucesso.

O plano vincula candidato, contrato, registros operacionais, revisão do controle e referências da decisão. Aplicar exige `--apply` e a identificação da pessoa que autorizou a correção na sessão. Uma alteração posterior invalida o plano. A identidade declarada é rastreabilidade, não autenticação independente.

A intenção fica persistida antes da alteração; aprovações de integração anteriores são retiradas de vigência sem apagar seus documentos. O histórico é somente acrescentado. Uma interrupção na persistência admite `resume` com o mesmo candidato e registros, sem repetir comandos externos. Ambiguidade, corrupção e operações concorrentes bloqueiam a correção.

## Uso

Execute a partir da raiz do consumidor autorizado. No Codex, os scripts ficam em
`.spectree/squad/scripts/`; no Claude, use o diretório do pacote carregado. O diagnóstico
pode ser executado pelo pacote novo contra um consumidor antigo sem instalar nada nele.

```powershell
node <pacote>/scripts/reconcile.mjs diagnose
node <pacote>/scripts/reconcile.mjs diagnose <change>
```

Inspecione os comandos reais e registre a decisão autorizada em um arquivo de requisição,
fora da árvore do candidato ou em diretório ignorado. Exemplo sintético:

```json
{
  "version": 1,
  "change_id": "example",
  "closure_mode": "legacy",
  "reason": "Contrato inspecionado: fechamento usa o mecanismo legado, sem consolidação prepared.",
  "actor": { "kind": "human_in_session", "identity": "operador que autorizou na sessão" },
  "refs": [".spectree/project.json", "package.json"]
}
```

```powershell
node <pacote>/scripts/reconcile.mjs plan <request.json> --output <plan.json>
# Revise before, after, refs, effects e aprovações que perderão vigência.
node <pacote>/scripts/reconcile.mjs apply <plan.json> --apply
node <pacote>/scripts/state.mjs plan <change> --json
```

O plano salva os hashes das referências; não edite o JSON de estado. O comando apply recusa
um plano alterado ou obsoleto. Se a persistência for interrompida, o diagnóstico informa:

```powershell
node <pacote>/scripts/reconcile.mjs resume <change> <operation> --apply
```

A retomada requer o mesmo candidato e os mesmos registros vinculados. Se houver divergência,
pare e inspecione os efeitos; não apague o controle ou a operação para forçar uma nova tentativa.
Erros de I/O devem ser corrigidos preservando os arquivos de auditoria. Uma operação obsoleta
não tem cancelamento automático neste ciclo.

Na Console, **Consultar runtime** mostra o diagnóstico da mudança selecionada ou do projeto
sem mudanças, inclusive antes da adoção. A consulta não aciona comandos de projeto, agentes,
correções ou instalações. Uma falha de consulta aos gates pode coexistir com um inventário
válido; verifique o status da consulta antes de usar a recomendação.

## Compatibilidade e implantação

- Projetos sem `closure.consolidate` devem passar `--closure-mode legacy` ao abrir uma mudança.
  Nomes como `spec:close` não ativam seleção automática.
- Os registros antigos continuam legíveis. Instalar o runtime não migra seu modo nem seu estado.
- A instalação da Console atualiza seu inspector; não atualiza o runtime do consumidor.
- Atualizar um consumidor ou aplicar a correção exige autorização de escrita naquele projeto.
  O canário de produção `spectree-workspace` permanece somente para leitura neste ciclo.

## Critérios de aceitação

- Recusar a adoção/open em modo prepared sem mecanismo declarado, antes da primeira escrita.
- Planejar sem alterar arquivos; recusar plano adulterado ou obsoleto.
- Corrigir o modo mantendo `blocked`, histórico, evidências e escopo; exigir os gates normais para recuperação.
- Recuperar uma interrupção antes/depois da escrita sem duplicar o evento ou conceder aprovação.
- Detectar arquivo em archive com estado ainda aberto e expor diagnóstico e próximo passo no Console.
- Executar o fluxo completo com gates de integração/fechamento em consumidor sintético; preservar o consumidor de produção somente para leitura.
