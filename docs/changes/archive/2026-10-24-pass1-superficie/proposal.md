# Pass 1 com superfície e red provado na asserção

Tarefa 10 do [ciclo de modularização do repositório](../../../ROADMAP.md#ciclo--o-repositório-seguindo-a-própria-arquitetura),
autorizada pelo Gilson em 2026-10-24, depois da avaliação da regra "o Quality Engineer escreve
os testes, que precisam falhar antes da implementação começar" contra a metodologia do curso e
contra o que o squad fez no `sindy-agent` (changes 1 e 2, leitura apenas).

**Sem delta em `specs/`.** Este repositório não tem specs vivos; o comportamento novo do runtime
é provado pelos testes desta mudança, e o resto da suíte segue verde.

## Problema

1. O protocolo exige que comportamento novo falhe **na asserção** e chama de `INFRA_ERROR` o
   import que não resolveu. Para código que ainda não existe, as duas regras não fecham juntas:
   o teste de um caso de uso novo quebra no import, e nenhum papel podia escrever o export antes
   da pass 1. O `sindy-agent` resolveu sozinho com uma tarefa `T-SURFACE`, fora do protocolo.
2. O runtime aceitava como pass 1 qualquer `not ok` do teste nomeado, inclusive "módulo não
   encontrado" dentro do corpo do teste, e registrava um teste por vez: 4 evidências para 79
   `Scenario`s na change 1 do `sindy-agent`, 2 para 86 na change 2.
3. Com Vitest, nenhum nome casava: o reporter acrescenta ` # time=…` ao nome, e o diagnóstico
   fica aninhado em `error:`, onde o parser não lia.

## Escopo

1. **Superfície antes da pass 1.** Regra nova em §7.2 do protocolo, inventariada em
   `protocol/rules.json`: quando um `Scenario` chama o que ainda não existe, um Developer escreve
   só exports e assinaturas, corpos com `NOT_IMPLEMENTED`, sem tabela e sem teste, num despacho
   comum. Cards do Solutions Architect (a tarefa entra no `tasks.md`), do Full Stack Developer
   (a missão) e do Quality Engineer (escrever contra a superfície e registrar a pass 1 inteira).
2. **`--expect-from <arquivo.json>`** em `state.mjs run … pass1.tests_failing`: a lista dos
   testes que devem falhar e das regressões preservadas que devem passar, julgada numa execução
   só. A evidência guarda as duas listas em `expected_tests` (schema de evidência atualizado).
3. **Red só na asserção.** Um teste vermelho cujo diagnóstico nomeia outra coisa que não uma
   asserção (`TypeError`, `Error` de módulo não encontrado) é `INFRA_ERROR`. Vale também para
   `--expect-failing`. Runner sem diagnóstico continua aceito como antes.
4. **Vitest no parser TAP.** O sufixo ` # time=…` sai do nome, e `code`/`name` são lidos também
   logo abaixo de `error:`. Efeito colateral bom: mutação morta passa a ser provável com Vitest.
5. Justificativa em `docs/protocol-rationale.md` e o uso em `docs/install.md`.
6. Arquiva a mudança da tarefa 9 (`tamanho-dos-cards`, PR #77) e marca a linha 9 do ROADMAP.

## Fora do escopo

- **O executor (`tasks.mjs`) não muda.** A superfície roda como despacho comum, como rodou no
  `sindy-agent`: a saída dela é typecheck, lint e guards, e o executor só julga testes nomeados.
  Levar a superfície para dentro dele exigiria um tipo novo de check, sem ganho observado.
- Nenhum consumidor é alterado. O `sindy-agent` foi só lido.

## Compatibilidade

`--expect-failing "<nome>"` continua funcionando. Muda uma coisa para quem já usa: uma pass 1
cujo único red é um `TypeError` ou um módulo que não resolveu, antes aceita, agora é
`INFRA_ERROR` — que é o que a regra do protocolo sempre disse.

## Resultado

| Medida | Antes | Depois |
|---|---|---|
| `CLAUDE.md` | 45.591 bytes | 45.934 bytes (teto 46.080) |
| Card do Solutions Architect | 33.660 bytes | 34.012 bytes (teto 34.816) |
| Regras no inventário | 174 | 175 |
