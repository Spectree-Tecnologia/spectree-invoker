# Instruções de revisão

Este arquivo diz a quem revisa um PR deste repositório o que importa aqui e o que não importa.
Vale para o Code Review do GitHub e para o revisor em contexto limpo do
[CONTRIBUTING](CONTRIBUTING.md#revisão-independente).

## Leia antes

- **O `CLAUDE.md` da raiz é produto, não instrução para revisar este repo.** Ele é gerado de
  `protocol/` e descreve o squad nos projetos que o plugin constrói. Uma mudança só o viola quando
  muda `protocol/` de um jeito que o contradiz.
- As convenções do código em `scripts/lib/` são os [papéis do repositório](docs/roles/README.md).
  Onde um papel e o código discordam, o código vence e o papel é corrigido na mesma mudança.
- A intenção do PR é a proposta que ele arquiva (`docs/changes/archive/<data>-<slug>/proposal.md`).
  Revise o diff contra o escopo e o **Fora do escopo** dela.

## O que é Importante aqui

Reserve Importante para o que muda o que o plugin impõe ou deixa passar:

- **Regra que sai do núcleo.** Uma frase normativa (`never`, `must`, `refuse`, `only`, "nunca",
  "só") de `protocol/0*.md` ou de `protocol/roles/*.md` que some, afrouxa ou vai para
  `docs/protocol-rationale.md` sem a proposta dizer isso. O `check-plugin` só cobre as regras
  inventariadas em `protocol/rules.json`; o resto é com você. Cite a linha removida.
- **Check enfraquecido.** Um teste apagado, pulado ou com a expectativa afrouxada; um passo de
  `.github/workflows/` removido, condicionado ou fora do agregado `required`; uma allowlist
  (`ADMINISTRATIVE` em `scripts/lib/evidence/diff.mjs`, `neutral_paths`) que passa a aceitar mais.
- **Recusa fora do papel.** Código novo em `scripts/lib/` que recusa com `throw new Error` sem
  código, decide por mensagem em vez de `code`, ou trata ausência como `false`
  ([refusals.md](docs/roles/refusals.md), [absence-is-unknown.md](docs/roles/absence-is-unknown.md)).
- **Escrita em `.spectree/` fora da camada de persistência** ou fora da ordem de lock
  ([persistence.md](docs/roles/persistence.md)).
- **Autoridade fabricada.** Código que grava aprovação, evidência observada, `integrated` ou
  `closed` sem a execução ou a pessoa que o protocolo exige.
- **Segredo, token ou dado de cliente** em qualquer arquivo.

## Sempre confira

- Edição à mão em arquivo gerado (`CLAUDE.md`, `agents/*.md`, `skills/*/SKILL.md`,
  `adapters/*/dist/`) sem a mudança correspondente em `protocol/`.
- Arquivo tocado que a proposta não justifica, e item do **Fora do escopo** que apareceu no diff.
- Versão: `package.json`, `package-lock.json` e `.claude-plugin/plugin.json` sobem juntas, e a
  proposta arquivada nomeia a mesma versão.

## Não reporte

- O que o CI já trava: drift entre `protocol/` e os gerados, integridade do pacote, tetos de bytes,
  a falta de archive ou de retro (`tests/repo-changes.test.mjs`), audit e segredos conhecidos.
- Idioma, tom, pontuação e formatação de documentação. Português e inglês convivem de propósito.
- Problema que já existia antes do PR. Se for grave, mencione uma vez como pré-existente, sem
  severidade.
- Sugestão de refatoração em código que o PR não mudou.

## Limites

- **No máximo três Nits por revisão.** Estilo, nome e refatoração são Nit no máximo.
- **Um achado sobre comportamento cita `arquivo:linha`** do código ou o trecho do diff. Inferência
  pelo nome de uma função não é achado.
- **Uma revisão por head.** Se três rodadas seguidas trouxerem achados novos, pare: o problema é a
  proposta, não o próximo commit.
