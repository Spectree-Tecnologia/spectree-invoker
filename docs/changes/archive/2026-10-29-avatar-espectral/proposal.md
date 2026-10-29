# Avatar principal espectral

Tarefa 46, pedida pelo Gilson em 2026-10-29: um motion no avatar principal, como se ele fosse visto em
outra dimensão, algo espectral.
Release: v1.85.0.

**Mudança deltaless.** Esta mudança não carrega delta em `specs/`. Ela muda só o painel do Claude Code;
nenhum comportamento do runtime muda.

## Escopo

1. **O ar ondula.** Uma distorção leve e contínua passa pelo centro inteiro, como se olhado através de
   outra dimensão.
2. **Dois fantasmas fora de fase.** Ecos do brilho do desenho, um em Spirit e outro em Depth, flutuam
   em direções opostas ao redor dele. O eco nasce da luz do desenho, então o corpo escuro não deixa
   mancha.
3. **Flicker.** De tempos em tempos, o desenho falha um instante, como um sinal que escapa.
4. A flutuação e o brilho da tarefa 45 continuam. Com movimento reduzido no sistema, tudo fica parado.

## Fora do escopo

- Os cards e o spinner não mudam.
- O efeito vale para o mascote e para o especialista que toma o lugar dele, sem arte nova.

## Verificação

- `claude plugin test .`: o centro tem a ondulação, os dois fantasmas, o flicker, e a regra de movimento
  reduzido cobre as cinco animações.
- `npm run check` verde.
- Preview animado mostrado ao Founder antes do PR.
