# Vigilância de avisos e resposta a incidentes

Tarefa 12b, autorizada pelo Gilson em 2026-10-24, a segunda entrega da frente de segurança aberta
depois das vulnerabilidades publicadas em 2026-10-21. Release: v1.50.0.

**Mudança deltaless.** Nenhum comportamento do runtime muda e esta mudança não carrega delta em
`specs/`. Muda o método do squad: duas skills novas e os ponteiros dos papéis que as carregam.

## Problema

A tarefa 12 pagou os gates de CI e a vigilância diária do lockfile. Ficou o que o D-014 registrou:
nada no squad dizia como transformar um aviso de segurança num fato sobre o projeto, nem como
trabalhar um incidente sem pular gates. O pedido do Founder foi um blue team; o protocolo (Seção 4)
já decidiu que ele não é um papel, porque a defesa se divide pelas fronteiras que já existem. O que
faltava era o processo que usa essas fronteiras.

## Escopo

1. **Retro da tarefa 11c** (`retro-gatilho`), devida por esta mudança, coletada com
   `retro.mjs collect 82`.
2. **`squad-security-watch`**, a skill do Integration Engineer: recebe o inventário tirado por
   comando (lockfiles, runtimes, componentes fora do lockfile), consulta as fontes em ordem
   (fornecedor, GHSA/OSV, NVD e CISA KEV, imprensa só como ponteiro) e devolve um bloco citado por
   aviso, com veredito `affected`, `not affected` ou `unknown`. `unknown` nunca vira `not affected`,
   e um relatório limpo só vale de ferramenta vista falhando antes.
3. **`squad-incident-response`**, a skill do Platform Engineer e do Invoker: triagem P1/P2/P3 por
   exploração e alcance; o que o Invoker contém sozinho (versão, recurso desligado, credencial de
   desenvolvimento ou CI) e o que é gate 3 (produção, credencial de produção, reescrita da branch
   padrão, comunicação externa); correção como mudança com teste discriminante; fechamento por
   comando.
4. **Ponteiros:** o Integration Engineer carrega a vigilância quando o Invoker a despacha, o
   Platform Engineer carrega a resposta quando o Invoker abre um incidente, e o Quality Engineer
   ganha a lente red team: o insumo hostil é a própria classe do aviso, só numa cópia descartável.
   A Seção 4 do núcleo cita as duas skills, e `docs/protocol-rationale.md` diz por que continuam
   não sendo um papel.
5. Manifesto, renderização nos dois harnesses, instalador e `tests/acceptance-regressions.test.mjs`
   passam a contar oito skills; as duas novas não são adaptações e não carregam atribuição.
   `tests/ci-security.test.mjs` trava os ponteiros e as garantias de cada skill.

## Fora do escopo

- Uma rotina agendada que despache a vigilância sozinha. O `security-watch.yml` já acusa o lockfile
  todo dia; a vigilância além do lockfile roda quando o Invoker a despacha.
- Um caso real de cada skill. O estudo de 2026-10-21 e a tarefa 12 foram o caso que gerou as
  skills, feito à mão; o primeiro caso que as usa fecha o D-014.
- O piso de runtime no consumidor (D-015) e o Node das sessões em nuvem (R-008).

## O que esta mudança deve e não paga

- D-014 entregue e ainda aberto: falta o primeiro caso real que use as skills, e fechar item exige
  evidência observada (D-009).
- O núcleo cresceu 68 bytes e ficou com 78 de folga; o D-013 é atualizado com os números novos.
