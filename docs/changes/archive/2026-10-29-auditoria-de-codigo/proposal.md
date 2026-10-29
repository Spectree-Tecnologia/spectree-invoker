# Auditoria de código com a skill `security-audit` da Cloudflare

Tarefa 51, autorizada pelo Gilson em 2026-10-29: ele pediu a skill
[`cloudflare/security-audit-skill`](https://github.com/cloudflare/security-audit-skill) no squad, aceitou
o encaixe proposto em `/mnt/project-files/analysis/security-audit-cloudflare-vs-squad.md` e o piloto
que veio antes desta mudança (`/mnt/project-files/analysis/security-audit-piloto/REPORT.md`).
Release: v1.89.0.

**Mudança deltaless.** Esta mudança não carrega delta em `specs/`. Ela muda o protocolo do squad e a
documentação de instalação. O runtime e o comportamento dos projetos consumidores não mudam.

## Problema

Hoje o squad cobre só a vulnerabilidade **conhecida**:

- `npm audit` e gitleaks na CI;
- `squad-security-watch` cruzando avisos com o inventário;
- `squad-incident-response` para quando um aviso chega;
- a lente red team do Quality Engineer, que só ataca o que a mudança tocou.

Ninguém procura falha **desconhecida** no código do próprio projeto, no repositório inteiro. A skill
da Cloudflare faz exatamente isso. Ela roda em seis fases, com dezenas de agentes isolados: cada
candidato a falha passa por um verificador que não o achou, e os resultados saem em `findings.json`
validado por schema.

O piloto `quick` sobre este repositório (`fa64575`) mostrou três coisas:

- **Ela reporta.** Uma falha plantada foi achada por quatro agentes que não sabiam dela.
- **Ela achou três problemas reais** (D-027, D-028, D-029).
- **O custo** foi de 17 agentes, 13 minutos e cerca de 1,8 milhão de tokens.

## Escopo

1. **Referenciar, não vendorizar.** A skill é MIT, mas o plugin não carrega cópia dela. Embutida, ela
   dispararia sozinha em qualquer pergunta de segurança em todo consumidor. Também furaria o fluxo em
   que as skills do squad são geradas de `protocol/skills/`. `docs/install.md` ganha a instalação
   opcional no nível do usuário, fixada no commit revisado (`c1c8a8c`).
2. **Fora do caminho padrão.** A auditoria completa precisa de uma sessão principal que dispara os
   agentes e escreve os arquivos da rodada. O Quality Engineer é subagente e não consegue dispará-los,
   e o Invoker não escreve arquivos. Por isso ela roda numa sessão própria, contra uma cópia
   descartável. Os momentos são três: antes da primeira exposição na internet, sob demanda ou por
   rotina, sempre com `budget` fixo. Nenhuma mudança espera por ela.
3. **O Quality Engineer é dono do resultado.** O card dele ganha um parágrafo com cinco regras:
   - um registro `confirmed` ou `needs_validation` é risco fundamentado até virar teste falhando;
   - todo registro que ainda não é teste entra no `docs/DEFERRED.md` pelo Platform Engineer, citando a revisão da rodada; é dali que o gate de exposição lê a última auditoria;
   - a rodada só é citada depois de vista reportando: falha plantada achada e os dois validadores
     recusando um arquivo quebrado;
   - um perfil `quick` ou com escopo é passe parcial;
   - no passe 2 de uma mudança que toca autenticação, entrada externa ou contexto de modelo, ele pode
     ler o arquivo de classes de ataque do domínio. Isso custa leitura, não agentes.
4. **Gate de exposição.** O card do Platform Engineer passa a levar ao Founder os registros abertos da
   última auditoria, ou o fato de que nenhuma rodou.
5. **Núcleo.** A Seção 4 cita a auditoria opcional ao lado das skills de segurança. O papel não muda,
   o que segue a D-014: blue team é processo.
6. **Os achados do piloto viram adiamentos com dono:**
   - D-027: o instalador do Codex segue symlinks do consumidor;
   - D-028: `record-evidence` aceita um `ci.green` forjado como observado;
   - D-029: o Console pode rodar um `git.exe` do projeto no Windows;
   - D-030: a cobertura que o piloto deixou adiada.
7. A retro de `retro-synd-guardas` (#121).

## Fora do escopo

- A correção dos achados A, B e C (D-027 a D-029). Ela vai numa change própria, com o Quality Engineer
  escrevendo o teste falhando antes, conforme a decisão do Founder.
- Uma rotina agendada que rode a auditoria. Fica para quando houver um projeto perto de ir para a
  internet.
- Os itens de endurecimento do piloto. Eles não são achados e ficam no relatório.

## O que esta mudança deve e não paga

- O núcleo fica a 24 bytes do teto (49.128 de 49.152). É a sétima vez que o teto decide a redação
  (R-004, D-013).
- A instalação documentada usa `git clone` fixado no commit. O Skills CLI (`npx skills add`) não foi
  verificado quanto a fixar uma revisão, então não é o caminho recomendado.
- O D-014 continua aberto: a auditoria de código não é um caso real das duas skills de segurança.
