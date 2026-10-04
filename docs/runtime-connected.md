# Runtime Conectado · ciclo 1.10

O executor produz uma trilha por operação antes de chamar um agente. Eventos de resultado, checks e reconciliação têm IDs, sequência, horário e referências aos cenários da missão. Registros antigos continuam legíveis; ausência da nova trilha não vira zero consumo ou sucesso.

## Contrato

1. Nenhum `tasks run/repair` chama um agente sem `run.started` persistido. O resultado e cada check executado deixam eventos correlacionados. `verify` e `recover` também registram suas observações.
2. O Console relaciona referências de especificação, cenários declarados, tarefas, tentativas e resultados dos checks. Isso não analisa cobertura semântica nem inventa Requirements.
3. Métricas preservam ausência como `null`, distinguem adapter/modelo solicitado de modelo reportado e não atribuem métricas de bridges sintéticas a modelos reais.
4. A atualização dos eventos permanece a cada cinco segundos. Avaliação do candidato é explícita e utiliza o planner e o status de tarefas existentes. Uma recomendação não é autorização.
5. Processos são inspecionados pela fronteira supervisionada quando disponível; recibos antigos de início, processos de outro host e sinais ambíguos não recebem o estado ativo.
6. Nenhuma avaliação dispara agente, check, aprovação ou transição. Projetos reais continuam somente leitura. Testes operacionais usam consumidores descartáveis.
7. Um launcher instalado em destino explícito aponta para uma cópia imutável do pacote, independente da pasta do terminal e da branch do checkout.

## Instalação do Console

Na raiz do pacote, execute primeiro o plano e depois aplique no destino escolhido:

```powershell
node scripts/install-console.mjs "$env:LOCALAPPDATA\SpectreeConsole"
node scripts/install-console.mjs "$env:LOCALAPPDATA\SpectreeConsole" --apply
# Funciona de qualquer pasta, inclusive C:\Windows\system32:
& "$env:LOCALAPPDATA\SpectreeConsole\spectree-console.cmd" --project "C:\caminho\do\projeto"
```

O instalador não altera PATH, perfil do terminal ou projeto consumidor. Cada release tem versão e hash de conteúdo; reaplicar uma release modificada é recusado. Atualizações criam outra release e atualizam o launcher. O Node precisa estar disponível no PATH.

## Limites de observação

A instrumentação cobre `tasks.mjs run/repair/verify/recover`. Dispatches diretos e históricos anteriores mantêm apenas os registros que efetivamente produziram. Projetos legados precisam de adoção estruturada explícita para entrar nesse caminho; abrir o Console não faz essa migração.

O snapshot é limitado a 8 MiB e sinaliza truncamentos. A consulta ao runtime tem prazo máximo de 30 segundos e recusa metadados excessivos, links, arquivos especiais e configuração Git que invoque filtros executáveis ou fsmonitor. Consulta até 20 operações; operações fora desse conjunto continuam sem inspeção de processo. No Windows, uma fronteira em andamento pode ser consultada pelo Job Object; no POSIX, sem prova da identidade da fronteira, o estado permanece desconhecido. Um recibo de término é identificado como observação do supervisor.

## Validação

Fluxo em consumidor sintético: plano com cenários → agente interrompido → reconciliação → nova tentativa → checks observados → Console → edição externa → evidência obsoleta. Cobrir persistência anterior ao dispatch, limites, dados ausentes, corrupção, isolamento entre mudanças e read-only. Fixtures de transporte não provam qualidade de modelos.

Validação em 2026-10-04: suíte completa com 359 testes aprovados; fluxo sintético observado pelo Console; consulta via instalação independente iniciada de `C:\Windows\System32`; inspector e viewport mobile sem overflow horizontal. A edição externa da fixture fez as duas tarefas aparecerem como obsoletas na consulta seguinte. Nenhuma instalação ou escrita foi feita no consumidor de produção. A primeira rodada de validação foi descartada após detectar alteração do pacote durante o benchmark e um timeout no teste de concorrência; a repetição estável passou integralmente.

## M4

Incorpora a observação de capacidade do adapter Claude da branch de correção M4. O Console distingue a capacidade declarada/observada pelo adapter da evidência de uma execução particular. Nenhuma animação, evento ou modelo reportado constitui prova adicional de independência de QA.
