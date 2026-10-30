# Tarefas

- [x] `tests/security-audit-fixes.test.mjs` com os quatro casos, vistos falhando em `68e6aeb`.
- [x] D-027: recusa de symlink no caminho em `install-codex.mjs`, dry run incluído.
- [x] D-028: `record-evidence` recusa `code_fingerprint` e `neutral_paths`.
- [x] D-029: `gitExecutable` no helper de git e na observação do Console.
- [x] `docs/install.md` e D-027 a D-029 atualizados; `DEFERRED.md` regenerado.
- [x] Retro de `auditoria-de-codigo` (#122), coletada com `retro.mjs collect 122 --apply`.
- [x] Arquivar esta mudança e marcar a linha 52 no próprio PR.

Ambiente da verificação: Linux, Node do container, suíte local completa.

Uma marca nesta lista não é prova; a evidência está no PR.
