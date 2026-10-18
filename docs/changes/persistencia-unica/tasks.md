# Tarefas

- [x] Criar `scripts/lib/shared/persistence.mjs` com `writeAtomic`, `writeOnce`, `publishOnce`, `withLock` e `LOCK_ORDER`.
- [x] Migrar `store`, `lifecycle` e o executor de tarefas para o `withLock`.
- [x] Migrar os demais escritores de `.spectree/` para as três gravações.
- [x] Testes em `tests/persistence.test.mjs`, com a guarda de escritores fora da camada.
- [x] Arquivar a mudança da tarefa 5c e atualizar ROADMAP, ledger (D-006) e `docs/architecture.md`.
- [ ] Suíte, build e integridade verdes no CI do PR.

Uma marca nesta lista não é prova; a evidência está no PR.
