# Contribuindo

Contribuições são bem-vindas. Todo código entra por pull request e só é integrado após revisão do mantenedor.

## Fluxo

1. Abra uma issue antes de mudanças grandes, para alinhar a abordagem.
2. Faça um fork e crie uma branch a partir de `main`.
3. Rode `npm run check` — é o mesmo portão do CI.
4. Abra o PR contra `main` descrevendo o quê e o porquê.

## Regras do repositório

- `protocol/` é a única fonte autoritativa. `CLAUDE.md`, `agents/*.md`, `adapters/codex/dist/` e a skill do Codex são **gerados**: edite o protocolo e rode `npm run build`. O CI recusa drift.
- Não inclua segredos, tokens ou dados de clientes. O push protection do GitHub bloqueia segredos conhecidos.
- Workflows de PRs de contribuidores externos só rodam após aprovação do mantenedor.
