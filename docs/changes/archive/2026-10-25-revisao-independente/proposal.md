# Revisão independente nos PRs deste repositório

Tarefa 21, autorizada pelo Gilson em 2026-10-25: a lacuna 1 do discovery que comparou o processo de
revisão da Anthropic (seis camadas e `REVIEW.md`) com o Invoker. Release: v1.59.0.

**Mudança deltaless.** Esta mudança não carrega delta em `specs/` e não muda o que o plugin impõe
aos consumidores. Ela muda como os PRs deste repositório são revisados.

## Problema

Nos projetos consumidores, o pass 2 do Quality Engineer é uma revisão adversarial em contexto
isolado. Neste repositório não existe nada equivalente: os 50 PRs integrados do #42 ao #91 têm zero
comentários e zero reviews, e a thread que escreve a mudança é a que a verifica. O #91 foi aberto e
integrado no mesmo minuto. O próprio protocolo diz que um passe adversarial na thread do autor não é
independente. E houve escape: o #76 tirou do núcleo a regra "uma suíte, nunca uma por Requirement",
e ninguém viu até a análise de custo de verificação (R-009, pago no #84).

## Escopo

1. **Retro da tarefa 20** (`baseline-rodada-ci`), devida por esta mudança, coletada com
   `retro.mjs collect 91`.
2. **`REVIEW.md` na raiz:** o que é Importante aqui, o que sempre conferir, o que não reportar e os
   limites (no máximo três Nits, achado com `arquivo:linha`, uma revisão por head, teto de três
   rodadas). Diz também que o `CLAUDE.md` da raiz é produto gerado, não instrução de revisão.
3. **Regra no `CONTRIBUTING.md`:** todo head integrado passa por um revisor em contexto limpo, que
   recebe só o diff, a proposta e o `REVIEW.md`; o que a revisão ensina volta ao `REVIEW.md` pela retro.
4. **Seção "Revisão independente" no template de PR.**
5. **`tests/repo-review.test.mjs`:** recusa `REVIEW.md` sem as seções, com caminho que não existe
   mais, e template de PR sem a seção.
6. **Prova antes de valer:** o revisor em contexto limpo, com o `REVIEW.md`, aponta a regra
   removida no diff do #76 (ver `verification.md`).

## Fora do escopo

- Ligar o Code Review do GitHub. Ele exige plano Team ou Enterprise e um Owner da organização; o
  `REVIEW.md` já serve a ele quando for ligado.
- Integração por política de risco (lacuna 2 do discovery). Muda o gate da `main` e é decisão do
  Founder; fica no D-016.
- `REVIEW.md` nos projetos consumidores, votação entre revisores, fila de merge e revisão de
  segurança do diff: o discovery não achou problema observado que os peça.
- Qualquer mudança em `protocol/`, nos cards ou no runtime.

## O que esta mudança deve e não paga

D-016, a integração por política de risco, registrada e não paga. D-017, as regras do núcleo que a
prova achou só na justificativa, registrado e não pago.
