# Retrato e orbs em vetor no painel

Tarefa 26, pedida pelo Gilson em 2026-10-25 ao ver o v1.64.0 no app desktop. Release: v1.65.0.

**Mudança deltaless.** Esta mudança não carrega delta em `specs/`. Ela troca a forma como o painel do
Claude Code desenha o retrato e os orbs; nenhum comportamento do runtime muda.

## Problema

No app desktop, o v1.64.0 mostrou o aura e os brilhos dos orbs, mas nem o retrato nem as pinturas
dos orbs: o app tira do `Svg` todo `<image>`, que só aceita referências internas à página. As
prévias do #97 eram do Chromium desenhando o SVG direto, que mostra o `<image>`, e não do app.

## Escopo

1. **`hooks/invoker-desk/portrait.ts`**: o avatar do Founder traçado em polígonos de cor chapada
   (260×273, cerca de 86 mil caracteres), no lugar da data URI. O avatar o encaixa no mesmo oval por
   um `<svg>` aninhado, sob um desfoque leve que tira o degrau dos polígonos.
2. **`hooks/invoker-desk/orb-art.ts`**: cada orb traçado em dois tamanhos. O `small` (56×56, cerca de
   7,8 mil caracteres) entra uma vez nos `defs` do avatar, e os seis orbs da órbita apontam para ele
   com `<use href="#...">`, a referência interna que o app aceita, por cima da esfera vetorial. O
   `large` (160×160, de 45 a 51 mil) é o avatar do card do subagente.
3. **Testes:** o `tests/invoker-desk.test.mjs` passa a aceitar os desenhos traçados só como
   `<svg viewBox>` com caminhos preenchidos, nada de `<image>`, referência ou marcação dentro deles, e mede o SVG do
   avatar e do card contra o teto; o kit cobra que avatar e card não levem `<image>`. Vistos
   falhando no código do #97.
4. A retro de `retrato-invoker` (#97), devida por esta.

## Decisões

- **Vetor traçado, não bitmap.** O app não desenha bitmap dentro de um `Svg` e não tem `Image` fora
  do terminal. O traço perde o degradê fino das pinturas; o detalhe vai até onde o SVG do avatar
  cabe no teto de 131.072 caracteres, com os orbs da órbita reaproveitados por `<use>`. SVGs feitos
  pelo Founder num vetorizador melhor entram trocando os dois arquivos, se passarem na guarda.
- **O traço é feito fora do repositório**, com o VTracer, e só o resultado entra; outra imagem entra
  trocando os dois arquivos.

## Fora do escopo

- O terminal continua com os orbs em glifos.

## O que esta mudança deve e não paga

O resultado foi visto no Chromium e no kit de testes; o app desktop, que é onde o #97 falhou, segue
sem ser visto antes do merge. A conferência fica com o Founder, e o R-011 volta a contar na retro.
