# Contribuindo

Contribuições são bem-vindas. Todo código entra por pull request e só é integrado após revisão do mantenedor.

## Fluxo

1. Abra uma issue antes de mudanças grandes, para alinhar a abordagem.
2. Faça um fork e crie uma branch a partir de `main`.
3. Rode `npm run check` — é o mesmo portão do CI.
4. Abra o PR contra `main` descrevendo o quê e o porquê.

## Regras do repositório

- `protocol/` é a única fonte autoritativa. `CLAUDE.md`, `agents/*.md`, `adapters/codex/dist/` e a skill do Codex são **gerados**: edite o protocolo e rode `npm run build`. O CI recusa drift.
- Quem edita `scripts/lib/` segue os [papéis do repositório](docs/roles/README.md): como uma recusa é devolvida, o que significa uma resposta ausente, como `.spectree/` é gravado e onde o código mora.
- Uma mudança em `docs/changes/` é arquivada, e a linha dela no `docs/ROADMAP.md` é marcada, no mesmo PR que a entrega. A [retro](docs/retros/README.md) dela vem no PR seguinte. `tests/repo-changes.test.mjs` recusa as duas faltas.
- Não inclua segredos, tokens ou dados de clientes. O push protection do GitHub bloqueia segredos conhecidos.
- Workflows de PRs de contribuidores externos só rodam após aprovação do mantenedor.
