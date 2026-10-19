## 5. Architecture and boundaries

**A module is a business capability, never a layer.** A module is three parallel folders:

```
modules/<module>/                     <- pure business. Own package. Zero framework.
apps/backend/src/modules/<module>/    <- adapter: controller, concrete repository
apps/frontend/src/modules/<module>/   <- UI
apps/<app>/src/shared/                <- app-wide concerns (session, theme, i18n). Never inside a module.
packages/shared/                      <- common infra. Everyone depends on it; it depends on no one.
```

Eight invariants. Folder names vary by stack; these do not.

**5.1 — Two surfaces.** Every module declares two entry points:

| Entry | Exports | Who may import |
|---|---|---|
| `<module>` | **DTOs and query contracts only** | any module |
| `<module>/internal` | entities, value objects, use cases, ports | only that module's own adapters |

Entities, use cases and value objects **never** cross a module boundary; a missing query is a mission for its owner's Developer.

**5.2 — The boundary has two halves, and the manifest defends only one.** Inside `modules/` the package resolver blocks deep imports; inside `apps/` nothing does. The CI check covers **both**:

- imports of `<module>/internal` from outside that module's own adapters;
- `apps/<app>/src/modules/A` importing `apps/<app>/src/modules/B` outside B's `index.ts`;
- the framework's routing folder reaching a module by anything but its published entry.

App-wide concerns (session, theme, i18n) live in `apps/<app>/src/shared/`, never inside a module.

**5.3 — Declared, acyclic graph.** Upstream supplies data, Downstream consumes, always one-directional. A cycle is a **modelling error**, rejected at gate 1.

**5.4 — Technology depends on business.** Port in the core, implementation in the adapter, injected through the constructor. The use case is provable without a database, framework or network.

Two consequences:
- delivery mechanism (token, JWT, session) belongs to the application layer, **never** the core;
- **the transaction boundary is a domain decision.** *What must be atomic* lives in the use case, expressed through an injected transaction port; *how* is infra. Two loose writes where a transaction belonged is a business defect.

**5.5 — Queries cross; commands cross only to read.** A command in A never invokes a rule in B. A command that must validate against B's state consumes a **narrow query** returning the minimum (`{ active: boolean }`), never the entity. Complex reads are raw queries returning a DTO, not ORM navigation.

**A write that has to happen in several modules does not bend this rule — it becomes a process.** One module upstream of every participant owns the process record and publishes its facts as DTOs; each participant runs its own use case in its own transaction and reports back as one of those facts. Every step a later failure can strand names a business compensation, the step that cannot be undone goes last, and a step's write and the fact announcing it are atomic.

**5.6 — `shared` is infrastructure, never business.** Base entity, result type, use-case contract, generic value objects. **A domain-named concept in there is a violation.**

**5.7 — Inside the module, the aggregate is the folder.** The core is **one folder per aggregate** — the entities inserted, updated and deleted in the same transaction — each holding its **model** (entities and value objects, carrying the rules), its **use cases** and the **ports** they receive. Whatever belongs to two or more aggregates — a flow, a value object, a port, a domain service — rises to the module level beside them, never inside one. A flat core has not been modelled.

**Three consequences that get built wrong when nobody says them out loud:**

- **A rule lives once, in the model.** The ruler, and it settles every case: *if the check has to ask the world, it belongs to the flow; if it only looks at the value, it belongs to the model.* Password strength is the model's; "this email is already taken" is the flow's. No entity reduced to getters and setters.
- **A rule that fits neither a value object nor an entity is a domain service** — one rule acting over entities no single one of them owns. **A use case does not call another use case**: two flows needing the same calculation both call the domain service.
- **A command goes through a use case; a query does not.** A list or a get-by-id reads through the port directly from the adapter; validating a query's input (refusing a page of 500) does not change this.

**5.8 — The route layer is thin.** The framework's routing folder maps a URL to a module's page and does nothing else: no business call, no query, no state, no composition. Pages, components and module state live in the module's UI folder. The routing folder may reach a module only through its published entry.
