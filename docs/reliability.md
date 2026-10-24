# Retomada e verificação — 1.6

Os controles desta versão respondem aos problemas observados no canário: encerramento
interrompido, estado estruturado vazio apesar de artefatos existentes, contexto repetido,
mutações temporárias no checkout e audit impedindo a execução dos demais checks.
A implementação e os testes ficam no Invoker; atualizar o pacote não migra o consumidor.

## Retomar sem reconstruir a conversa

Execute os comandos na raiz do projeto consumidor. `<squad>` é a raiz do plugin Claude
ou `.spectree/squad` na instalação Codex. `SPECTREE_PROJECT_ROOT` permite apontar uma
raiz explicitamente. `doctor` e `resume` apenas leem.

```text
node <squad>/scripts/work.mjs doctor
node <squad>/scripts/state.mjs resume <change>
node <squad>/scripts/work.mjs resume <change>
```

`doctor` diferencia registros estruturados de artefatos legados. Uma pasta `.spectree`
vazia não prova adoção, e uma pasta arquivada não prova integração. Changes sem registro
continuam visíveis para reconciliação; nenhum histórico ou aprovação é inventado.

Antes de uma operação, o Invoker grava seu início. Cada tentativa tem ID próprio:

O checkpoint requer um repositório Git com ao menos um commit e um ID de change.
Exploração inicial continua somente leitura; bootstrap usa o log do Platform até esse
primeiro commit. `doctor` pode ser usado antes disso.

```text
node <squad>/scripts/work.mjs start c1 prepare-01 --phase prepare --task "tasks.md#closure" --next "Inspect preparation result" --refs docs/changes/c1/tasks.md
node <squad>/scripts/work.mjs finish c1 prepare-01 --result harness-result.json --next "Verify prepared artifacts" --refs .spectree/closure/c1.json
```

O arquivo de resultado deve conter o envelope real retornado pelo harness. `completed`
com quota esgotada é interrupção; sucesso reportado continua sendo relato, não evidência
observada. Um envelope desconhecido exige reconciliação. Não fabrique um envelope para
desbloquear o fluxo. Termine o checkpoint antes de tentar uma transição de estado.

Após interrupção, leia os efeitos antes de repetir qualquer comando. Inspecione arquivos,
index, manifesto e, quando aplicável, o resultado remoto. Registre a conclusão:

```text
node <squad>/scripts/work.mjs reconcile c1 prepare-01 --note "Archive exists; manifest incomplete; merge did not occur" --next "Recover native preparation journal" --refs docs/changes/archive/c1/proposal.md
```

Os eventos ficam em `.spectree/work/<change>/<operation>/`, com criação exclusiva e
recusa de sobrescrita. O pacote de retomada traz as dez operações mais recentes e todas
as pendentes, com hashes das referências e aviso de conteúdo alterado. Campos e referências
têm limites de tamanho. Não inclua credenciais, dumps ou transcrições nesses campos.
Eventos corrompidos bloqueiam a leitura: preserve os bytes e investigue a gravação parcial;
não apague o histórico nem repita a operação para esconder a incerteza.

Transições estruturadas e o planejador recusam checkpoints pendentes. Em projetos legados,
o acompanhamento funciona, mas a aplicação dos gates continua dependente do protocolo até
a adoção explícita do estado estruturado. Os journals nativos de fechamento continuam sendo
a autoridade para recuperar preparação e confirmação. Checkpoints não dão aprovação.

## Documentação e log não invalidam a medição do código

Uma evidência registrada por `state.mjs run` guarda o `fingerprint` do conteúdo inteiro e o
`code_fingerprint`, o mesmo conteúdo sem os caminhos neutros. Se depois só um caminho neutro
mudou, a evidência é **levada adiante**: o gate aceita, avisa `carried forward` com os ids e o
`resume` a lista com `carried_forward: true`. Uma execução no conteúdo atual tem precedência; um
vermelho nele vence um verde levado adiante. As aprovações continuam presas ao conteúdo inteiro.

Por padrão só `.log/` é neutro, porque o Platform Engineer escreve nele a cada ação. O projeto
declara outros em `.spectree/project.json`:

```json
{ "evidence": { "neutral_paths": [".log/", "docs/DEFERRED.md", "docs/ROADMAP.md", "README.md"] } }
```

Um caminho só é neutro se também for documentação para o classificador de diff
(`docs/**/*.md` fora de `docs/specs/`, `README.md`, `CHANGELOG.md`, `LICENSE`, `.log/*.log`):
declarar `src/` não neutraliza nada. Declare só o que nenhum teste lê. A lista entra na
evidência, e mudar a lista depois deixa de levar adiante as evidências antigas.

## Mutação fora do checkout

Um plano é JSON com `target`, `before`, `after`, `test_name`, `command` (array argv),
`timeout_seconds` e, opcionalmente, `setup_command`. O fragmento original deve ocorrer
exatamente uma vez. Exemplo para um teste Node que usa `node:assert`:

```json
{
  "target": "src/amount.cjs",
  "before": "return forecast;",
  "after": "return effective;",
  "test_name": "editing a label preserves forecast",
  "command": ["node", "--test", "--test-reporter=tap", "tests/amount.test.cjs"],
  "timeout_seconds": 60
}
```

```text
node <squad>/scripts/mutation-probe.mjs mutation.json
node <squad>/scripts/mutation-probe.mjs mutation.json --apply
```

O primeiro comando só mostra o plano. O segundo copia arquivos versionados e não ignorados
do candidato atual, incluindo alterações locais, para uma pasta temporária externa. Não
copia `.git`, estado operacional, dependências, arquivos de ambiente ou formatos comuns de
credenciais. Symlinks/junctions são recusados. Dependências necessárias devem ser instaladas
pela preparação explícita na cópia; não há hardlinks nem reaproveitamento de `node_modules`.
Mudanças nos arquivos copiados pela preparação ou baseline invalidam o ensaio.

O teste precisa passar antes e falhar por asserção depois da mutação. A saída deve ser TAP
completo e conter exatamente o nome solicitado. O adaptador atual reconhece `ERR_ASSERTION`
ou `AssertionError` no diagnóstico do teste. Falha de sintaxe, timeout, teste ausente ou
diagnóstico não suportado retorna `INFRA_ERROR`; mutação sobrevivente retorna `FAIL`.
O comando imprime JSON e retorna código 1 para ambos. `PASS` indica discriminação pelo teste,
não aprovação do change nem observação de todo o produto.

Várias mutações vão num plano só, em lote: `mutations` lista cada uma com `id`, `target`,
`before`, `after` e `test_name`, ao lado de um único `command`, `setup_command` e
`timeout_seconds`. O lote usa uma cópia, um setup e uma baseline em que todos os testes nomeados
passam. Cada mutante é aplicado à cópia intacta, roda e é revertido antes do próximo.
`mutant_command` pode trazer `{test_name}`, para o mutante rodar só o teste que deve matá-lo. Um
sobrevivente reprova o lote e é nomeado. Um mutante inconclusivo nunca conta como morto.

A cópia evita alterações acidentais da mutação no checkout; **não é sandbox de segurança**.
Use somente comandos confiáveis, sem serviços de produção. Código executado ainda tem as
permissões do usuário e pode acessar rede ou caminhos absolutos. Um encerramento forçado do
processo pode deixar a cópia temporária para limpeza posterior. O resultado também é recusado
se o digest do candidato original mudar durante o ensaio.

## Plano de verificação, baseline e CI

O Architect escreve `verification.json` ao lado de `tasks.md`. Veja
[o exemplo](examples/verification.json) e valide antes da execução:

```text
node <squad>/scripts/verification.mjs plan docs/changes/c1/verification.json
node <squad>/scripts/verification.mjs checks docs/changes/c1/verification.json suite.tap
node <squad>/scripts/verification.mjs baseline c1 local
node <squad>/scripts/verification.mjs ci docs/changes/c1/verification.json job-results.json
```

Cada check comportamental declara o Scenario, o contraexemplo e a falha esperada. Inventários
continuam úteis, mas não substituem checks comportamentais. Mudança no significado de um
campo exige criar, ler, editar outro campo, salvar e reler, preservando o invariante declarado.
QA precisa executar esse fluxo; validar o JSON não prova que ele foi testado.

Um check traz `command` (argv próprio) ou `tests` (nomes exatos de testes), nunca os dois.
Prefira `tests`: a suíte roda uma vez com reporter TAP e `checks` julga todos a partir desse
relatório. Cada nome precisa aparecer uma única vez entre os testes que rodaram, passar e não
ter `SKIP` ou `TODO`; o veredito de um grupo (`describe`) não conta como teste. Um relatório
incompleto ou com `Bail out!` não julga nada (`INFRA_ERROR`). Checks com `command` aparecem como
`NOT_EVALUATED` e continuam exigindo execução própria. Nunca rode a suíte uma vez por check ou
por Requirement: no SYND C3a, esse laço levou 28 min de um job de 30, contra 72 s da suíte.

O baseline consulta evidência `suite.baseline` observada no commit base e no fingerprint exatos.
Declare `local` ou `ci` em `tasks.md`; o campo `environment.ci` da evidência precisa ser booleano.
Resultado vermelho não supersedido e verde no mesmo ambiente/base continuam instabilidade.
Resultados não resolvidos de outro ambiente aparecem no diagnóstico; verde no CI não explica
a causa de vermelho local. Históricos sem identidade suficiente exigem observação nova.

[O exemplo de CI](examples/consumer-ci.yml) separa audit e testes em jobs obrigatórios e
agrega seus resultados mesmo quando um falha. Ele roda em pull request e no push da main,
cancela a rodada anterior do mesmo ref, roda a suíte uma vez, julga os checks das changes
abertas a partir desse relatório e entrega `SPECTREE_TEST_NAMESPACE` por rodada para o nome do
banco de teste. Changes arquivadas não ganham passo próprio. Ajuste os comandos ao projeto e configure
`required` como check obrigatório da branch. O validador recusa dependência direta ou indireta
de testes em audit, ciclos, jobs ausentes e agregação incompleta. O arquivo de resultados
é um objeto como `{"audit":"success","tests":"success"}`, obtido do CI real. Resultados
`failure`, `skipped`, `cancelled` ou ausentes recusam o agregado.

Estes validadores são comandos explícitos exigidos pelo protocolo; não interceptam todo
comando externo e não alteram automaticamente os gates existentes. Não analisam o YAML real
nem buscam runs remotos: o Platform Engineer precisa manter a declaração fiel ao workflow e
o Invoker verificar a evidência. O instalador transporta comandos, manual e exemplos; não
instala o workflow no consumidor nem altera branch protection.

As versões das actions no exemplo seguem a documentação oficial consultada em 2026-10-02:
[checkout](https://github.com/actions/checkout) e [setup-node](https://github.com/actions/setup-node).
