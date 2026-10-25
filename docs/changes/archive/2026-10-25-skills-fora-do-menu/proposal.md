# Skills do squad fora do menu de slash

Tarefa 23, autorizada pelo Gilson em 2026-10-25. Release: v1.62.0.

**Mudança deltaless.** Esta mudança não carrega delta em `specs/`. Ela muda só o frontmatter que o
adaptador do Claude Code gera para as skills do squad.

## Problema

No Claude Code, toda skill de plugin aparece no menu `/` como `/spectree:<nome>`, salvo quando o
frontmatter diz o contrário. As oito skills `squad-*` só tinham `name` e `description`, então o
Founder via, ao digitar `/spec`, oito comandos que não são dele ao lado de `/spectree:invoker`.
Quem carrega cada uma é o agente cuja fase chega nela (Invoker, Solutions Architect, Quality
Engineer, Full Stack Developer, Platform Engineer, Integration Engineer), nunca o Founder.

## Escopo

1. **`skill_frontmatter` no `adapters/claude-code/adapter.json`**, com `"user-invocable": false`,
   que o `scripts/build.mjs` acrescenta ao frontmatter de cada skill do squad desse adaptador. A
   documentação do Claude Code (https://code.claude.com/docs/en/skills) diz que esse campo tira a
   skill do menu `/` e mantém a carga pelo modelo. O Codex não recebe a chave.
2. **`check-plugin`:** a skill gerada traz cada chave que o adaptador declara, e o adaptador do
   Claude Code declara `user-invocable: false` e não declara `disable-model-invocation`, que
   impediria os agentes de carregar a skill.
3. Uma frase no `docs/install.md`.
4. A retro da mudança anterior, devida por esta.

## Fora do escopo

- O menu do Codex: a skill `spectree-invoker` é a entrada, e as skills do squad seguem visíveis
  lá; esconder no Codex é outro mecanismo e outra mudança, se fizer falta.
- `disable-model-invocation` em qualquer skill.

## O que esta mudança deve e não paga

Nada novo.
