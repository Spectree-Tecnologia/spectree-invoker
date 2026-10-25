# Retrato do Invoker e tempo da sessão no painel

Tarefa 25, autorizada pelo Gilson em 2026-10-25. Release: v1.64.0.

**Mudança deltaless.** Esta mudança não carrega delta em `specs/`. Ela troca o avatar do painel do
Claude Code e corrige o tempo que ele mostra; nenhum comportamento do runtime muda.

## Problema

Visto pelo Founder no app desktop, logo depois do merge do #96:

1. O Invoker desenhado em vetor ficou infantil. Ele pediu uma arte realista e mandou a imagem de
   referência.
2. O stat "Tempo" mostrou `349:56:43`. O painel contava desde o `startedAt` do Claude Code, que numa
   sessão retomada é a primeira abertura dela, dias atrás.

## Escopo

1. **`hooks/invoker-desk/portrait.ts`**: a imagem do Founder, recortada no busto, 328×344, JPEG,
   em data URI de cerca de 26 mil caracteres. O avatar a desenha num oval de borda esmaecida dentro da
   órbita, e os orbs seguem girando por cima. Com `PORTRAIT` vazio, volta o desenho vetorial.
2. **O tempo conta desde esta abertura da sessão**, lido do relógio no `session.start`.
3. **Testes:** a sessão retomada mostra o tempo desta abertura (visto falhando com o código do
   #96); o avatar embute a imagem; o `tests/invoker-desk.test.mjs` recusa um retrato que não seja
   imagem em base64 ou que leve o SVG do avatar além de 131.072 caracteres.
4. A retro de `painel-invoker` (#96), devida por esta.

## Decisões

- **A imagem é a que o Founder mandou, como está**, por escolha dele no cartão da thread. Ela não tem
  autor nem licença conhecidos e retrata um personagem da Valve num repositório público. O risco de
  licença é dele, aceito por escrito; outra imagem entra trocando só `portrait.ts`.
- **O custo continua o do Claude Code**, acumulado desde a primeira abertura, como o `/cost`.

## Fora do escopo

- O terminal continua com os orbs em glifos; o `Image` do terminal fica para quando alguém pedir.

## O que esta mudança deve e não paga

O retrato e o tempo foram vistos só no kit de testes e numa renderização local; a conferência no app
desktop segue com o Founder, registrada na retro como R-011.
