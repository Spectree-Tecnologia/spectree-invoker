# Verificação

## O check novo recusa o #76

Com o `check-plugin.mjs` desta mudança copiado para duas worktrees: em `f81421f^1` (antes do #76),
`--write-normative` listou 307 frases normativas no protocolo; com essa lista, o check em `f81421f`
(o #76) falhou com 263 "dropped the normative sentence" (medido no head final; a primeira versão
do padrão, sem `requires`/`always`/`shall`, deu 301 e 258, e as 258 foram as classificadas), entre elas a do R-009 ("One complete
observed suite can support multiple Scenarios; repeat neither database setup nor the suite per
Requirement") e "Each revision adds at most three attempts, up to ten total…". No head desta
mudança, o mesmo check passa com 166 frases listadas.

`tests/package-integrity.test.mjs` tira uma frase do §7 e põe outra que ninguém listou, numa cópia
do pacote: as duas recusas aparecem.

## A classificação das 258

Um revisor em contexto limpo recebeu só a lista, o `CLAUDE.md` e o protocolo, e classificou cada
frase: 206 mantidas, 34 justificativa, 18 perdidas, com o trecho do núcleo como evidência de cada
"mantida". Casos limítrofes que ele marcou como mantidos por uma regra mais geral: "re-verifies the
roles it touched", "Never a review or an opportunistic fix", "bound to the exact approval in force",
"applied against the world it was computed in", "red and green at the same base are instability".
Uma das 18, "A mechanical mistake becomes a check…", foi conferida à mão: a skill
`squad-closure-retro` diz o mesmo nas categorias "Automated checks", "Review standards" e "No-ops".

## Suíte

`npm run check` verde: 639 testes, 0 falhas, Node 22.23.4.
