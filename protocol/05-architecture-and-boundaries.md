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

Entities, use cases and value objects **never** cross a module boundary. Need a new query from a neighbour? That's a mission for the neighbour's Developer.

**5.2 — The boundary has two halves, and the manifest defends only one.** Inside `modules/` the package resolver blocks deep imports. Inside `apps/` these are folders in the same package — nothing blocks anything. The CI check covers **both**:

- imports of `<module>/internal` from outside that module's own adapters;
- `apps/<app>/src/modules/A` importing `apps/<app>/src/modules/B` outside B's `index.ts`;
- the framework's routing folder reaching a module by anything but its published entry — the half that hides, because code there is inside no module and a module-against-module check reports it clean.

App-wide concerns (session, theme, i18n) live in `apps/<app>/src/shared/`, never inside a module. Half a boundary passing for a whole one is how a modular monolith becomes a Big Ball of Mud with nobody noticing.

**5.3 — Declared, acyclic graph.** Upstream supplies data, Downstream consumes, always one-directional. A cycle is a **modelling error** — rejected at gate 1, not discovered by the build.

**5.4 — Technology depends on business.** Port in the core, implementation in the adapter, injected through the constructor. The use case is provable without a database, framework or network.

Two consequences the AI violates on its own:
- delivery mechanism (token, JWT, session) belongs to the application layer, **never** the core;
- **the transaction boundary is a domain decision.** *What must be atomic* lives in the use case, expressed through an injected transaction port. *How the transaction is implemented* is infra. A Developer who fails to express atomicity because "I can't touch the database" misread the rule — and two loose writes where a transaction belonged is a business defect, not an infra one.

**5.5 — Queries cross; commands cross only to read.** A command in A never invokes a rule in B. A command that must validate against B's state consumes a **narrow query** returning the minimum (`{ active: boolean }`), never the entity. A narrow query that doesn't exist is a mission for its owner. Complex reads are raw queries returning a DTO, not ORM navigation.

**5.6 — `shared` is infrastructure, never business.** Base entity, result type, use-case contract, generic value objects. **A domain-named concept in there is a violation** — it lets any module consume a concept without declaring the dependency, and the module graph starts lying.

**5.7 — Inside the module, the aggregate is the folder.** The module's core is not a flat bag of entities: it is **one folder per aggregate** — the entities that are inserted, updated and deleted in the same transaction — and inside each, the three roles that already exist everywhere else in this document: the **model** (entities and value objects, carrying the rules), the **use cases** (the flows of that aggregate), and the **ports** the use cases receive. Whatever belongs to two or more aggregates rises to the module level, beside them and never inside one of the two — a flow that spans them, but equally a value object both use, a port both receive, and a domain service acting over both. The rule is one rule and it is about **ownership**: a thing owned by no single aggregate does not live inside one, because the day the other aggregate needs it nobody can say why it was over there.

The same aggregate test that decides where a module boundary falls decides this one, applied one level down — which is why it needs no second rule. A module whose core is flat has not been modelled, only filled.

**Three consequences that get built wrong when nobody says them out loud:**

- **A rule lives once, in the model.** The ruler, and it settles every case: *if the check has to ask the world, it belongs to the flow; if it only looks at the value, it belongs to the model.* Password strength is the model's; "this email is already taken" is the flow's. An entity reduced to getters and setters pushes every rule into the use cases, and then each use case has to **remember** to validate — one that forgets writes invalid data with nothing to stop it.
- **A rule that fits neither a value object nor an entity is a domain service** — a class with one rule in it, acting over a set of entities that no single one of them owns. It exists because **a use case does not call another use case**: when two flows need the same calculation, both call the same domain service instead of duplicating it.
- **A command goes through a use case; a query does not.** Commands are where the rules are. A list or a get-by-id has no rule to run, and a use case that only forwards to the repository is ceremony — the adapter reads through the port directly. Validating a query's input (refusing a page of 500) is not a rule and does not change this.

**5.8 — The route layer is thin.** The framework's routing folder maps a URL to a module's page and does nothing else: no business call, no query, no state, no composition. Pages, components and module state live in the module's UI folder, where the boundary applies to them. A screen written directly in the routing folder is outside every module, so **nothing checks it** — it can import any core it likes and no boundary defends anything. The check covers this: the routing folder may reach a module only through the module's published entry.
