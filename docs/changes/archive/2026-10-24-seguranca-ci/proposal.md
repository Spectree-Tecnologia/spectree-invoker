# Gates de segurança na CI e piso do Node

Tarefa 12, autorizada pelo Gilson em 2026-10-24, depois do estudo das vulnerabilidades publicadas
em 2026-10-21 (PHP, Node.js, NGINX, Go, GitLab e as chaves de CA da eMudhra). Release: v1.48.0.

**Mudança deltaless.** Nenhum comportamento do runtime muda e esta mudança não carrega delta em
`specs/`. Muda a CI deste repositório, o piso de runtime e o blueprint de CI do consumidor.

## Problema

1. O protocolo (Seção 4) diz que a segurança vive em "dependency and secret scanning in CI". A CI
   deste repositório não rodava nenhum dos dois, enquanto `docs/examples/consumer-ci.yml`, o
   blueprint que o Invoker ensina ao consumidor, já rodava o audit.
2. `engines` aceitava `node >= 20.11.0`. A release de segurança do Node de 2026-10-21 corrige um RCE
   no decodificador Brotli (CVE-2026-111497), dois bypasses de hostname TLS e passa a rejeitar as
   cadeias das chaves comprometidas da eMudhra, só em 22.23.4, 24.22.1 e 26.12.1. A linha 20 é EOL
   e não recebe a correção. A Presence faz `fetch` e WebSocket para a API da OpenAI, que é a
   condição de exploração do Brotli somada à confiança na CA comprometida.
3. A CI rodava com o token padrão do repositório, deixava a credencial no disco do runner em todos
   os jobs e usava actions por tag móvel.

## Escopo

1. `engines.node` passa a `^22.23.4 || ^24.22.1 || >=26.12.1`, e `.npmrc` liga `engine-strict`:
   `npm ci` recusa runtime abaixo do piso em vez de avisar. Visto recusando em Node 22.22.0.
2. `check.yml`: `permissions: contents: read` no topo; `persist-credentials: false` em todo checkout
   menos o do job `tag`, que empurra a tag; actions fixadas por SHA de commit; Node `22.x` com
   `check-latest`. No job `plugin`, que já é obrigatório, antes da suíte:
   - `npm audit --audit-level=high`, visto recusando um lockfile com `lodash@4.17.4`;
   - gitleaks 8.30.1 sobre o histórico inteiro, baixado com SHA-256 conferido, visto recusando um
     commit com um token do GitHub.
   O conjunto obrigatório (`classify`, `plugin`) não muda, então `ci-policy.mjs` e a proteção de
   branch ficam como estão.
3. `security-watch.yml`: o mesmo audit, todo dia, contra a `main`. Um aviso publicado hoje torna
   vulnerável o lockfile verde de ontem sem nenhum commit; o run vermelho é o alarme e a correção
   entra como mudança comum. Não bloqueia nem publica nada.
4. `docs/examples/consumer-ci.yml` ganha o mesmo secret scan, e o piso de Node é atualizado no
   README, em `docs/compatibility.md` e em `docs/console.md`.
5. `tests/ci-security.test.mjs` trava o piso, o `engine-strict`, as actions por SHA, o token só de
   leitura, nenhuma credencial persistida e os dois gates. Cada guarda é vista primeiro recusando o
   formato que a `main` tinha.
6. Retro da tarefa 11b (`retro-coleta`), devida por esta mudança.

## Fora do escopo

- **Dependabot.** Cada merge na `main` sobe a versão e vira tag; um PR do Dependabot não sobe, e o
  job `tag` falharia no merge. A vigilância diária cobre o aviso novo sem esse atrito.
- O resto do blue team: a skill de vigilância de avisos (Integration Engineer), o playbook de
  incidente (Platform Engineer) e a lente red team do Quality Engineer. Registrados no D-014.
- O piso de runtime nos projetos consumidores: os scripts instalados rodam no Node do consumidor e
  o `capabilities` só relata a versão. Registrado no D-015.

## O que esta mudança deve e não paga

D-014 e D-015, registrados com dono e gatilho.
