# Retro pós-merge: tendências e leitura do Architect

Tarefa 11d, autorizada pelo Gilson em 2026-10-25: a última fatia da retro pós-merge. Release: v1.60.0.

**Mudança deltaless.** Esta mudança não carrega delta em `specs/`. Ela acrescenta um subcomando de
leitura ao `retro.mjs` e uma regra de leitura ao card do Solutions Architect.

## Problema

As retros já são coletadas (11b) e cobradas (11c), mas ninguém lê as retros em conjunto. A regra do
método, "segunda recorrência vira mudança própria; achado sem recorrência em três mudanças fecha",
depende de alguém contar à mão as ocorrências em 16 arquivos. A tabela do `docs/retros/README.md`
é mantida assim, e a contagem do piloto já saiu errada uma vez (R-002, 9 em vez de 12). E o que as
retros aprendem não chega a quem escreve a próxima proposta.

## Escopo

1. **Retro da tarefa 21** (`revisao-independente`), devida por esta mudança, coletada com
   `retro.mjs collect 92`.
2. **`retro.mjs trends [--dir docs/retros]`:** lê as retros escritas, agrupa os achados pela
   assinatura, da mais antiga para a mais nova, e responde `recurring` (assinatura em duas ou mais
   retros que nenhum índice marca como paga) e `quiet` (achado aberto que nenhuma das três últimas
   retros citou). A situação vem da tabela do `README.md` da pasta quando ela existe; sem ela, fica
   desconhecida, e desconhecida nunca conta como paga. Só leitura.
3. **Feed-forward:** o card do Solutions Architect lê `trends` antes da proposta e nomeia, no
   `proposal.md`, o achado recorrente da área que a mudança toca, pago ou deixado de fora com o
   motivo. A skill `squad-closure-retro` passa a pedir a assinatura na linha do achado e a ler
   `trends` depois da coleta.
4. **Item permanente `retro-melhorias` no ROADMAP,** com `policy: scope`: uma mudança deltaless que
   paga um achado recorrente ou fecha um quieto, sem criar módulo, sem afrouxar regra ou check e
   sem passo irreversível, tem o escopo aprovado pela decisão já tomada. O merge continua pedindo a
   autorização do Founder.

## Fora do escopo

- Fechar ou pagar os achados que `trends` aponta hoje (R-001 e R-004 quietos; R-008 recorrente):
  cada um é julgado por uma retro e entra pelo item `retro-melhorias`.
- Gerar a tabela do `docs/retros/README.md` a partir de `trends`: a situação de cada achado é
  julgamento e continua escrita à mão.
- Abrir as mudanças deste repositório com `state.mjs` (D-009).
- Mexer em `DEFERRED.md`.

## O que esta mudança deve e não paga

Nada novo. A recorrência do R-008 desta sessão fica na retro do `revisao-independente`.
