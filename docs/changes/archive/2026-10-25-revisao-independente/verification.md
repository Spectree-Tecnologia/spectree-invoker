# Verificação — o revisor em contexto limpo sobre o diff do #76

O #76 (`tamanho-do-protocolo`, merge `f81421f`) é o escape conhecido: tirou regra do núcleo e
ninguém viu (R-009). Antes de a revisão contar como camada, ela tinha de ser vista pegando isso.

## Como rodou

Dois subagentes novos (não forks), em paralelo, sobre uma worktree em `f81421f`, cada um recebendo
só o intervalo `f81421f^1..f81421f` e a proposta da mudança. Nenhum recebeu a conversa, o
raciocínio do autor nem a dica de onde estava o defeito. Um recebeu também este `REVIEW.md`; o
outro, não (controle).

## Resultado

| Revisor | Achou o defeito | Como |
|---|---|---|
| Com `REVIEW.md` | Sim, como Importante 1 | Frases normativas que saíram de `protocol/07` e só existem na justificativa, que se declara não vinculante; listou 13 trechos com a linha da base. Importante 2: o inventário de `check-plugin` casa só a frase de abertura, então um corpo esvaziado passa. Três Nits, dentro do limite. |
| Sem `REVIEW.md` | Sim, como Importante 1 | O mesmo defeito, com 7 trechos citados pela linha do `CLAUDE.md` da base e a mesma causa no inventário. |

Os dois pegaram a classe do defeito e a causa que deixou passar. Nenhum dos dois citou
literalmente a frase do R-009 ("repeat neither database setup nor the suite per Requirement"),
que já tinha voltado ao núcleo no #84; os dois a cobriram pelo trecho do perfil de confiabilidade
de entrega em que ela estava.

**O que a prova sustenta:** um revisor independente pega esse escape. **O que ela não sustenta:**
que o `REVIEW.md` foi o que fez a diferença. O controle achou o mesmo defeito, então o ganho medido
aqui é a revisão em contexto limpo; o `REVIEW.md` se paga pelo que ele corta (Nits, o que o CI já
trava, pré-existente) e por servir ao Code Review do GitHub, e isso só a retro dos próximos PRs mede.

## O que a prova achou além do escape

Seis frases normativas do #76 continuam só em `docs/protocol-rationale.md` na `main` atual
(`4a51738`), conferidas por `grep -c` no `CLAUDE.md` (0) e na justificativa (1): "at most three
attempts", "no successful rerun erases", "all completed Scenarios must pass again", "Changed
inputs invalidate", "reviewed complete test inventory", "negative control first". Está fora do
escopo desta mudança e fica no D-017.
