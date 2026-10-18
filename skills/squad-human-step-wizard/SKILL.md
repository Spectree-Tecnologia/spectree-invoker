---
name: squad-human-step-wizard
description: What the Platform Engineer delivers when a step genuinely needs the Founder's own hands — a credential in a third-party dashboard, a consent click, a cutover — an interactive script that walks him through it and checks each stage, never a list of instructions. Load when a step is human by nature.
---

<!-- GENERATED FILE — do not edit.
     Source: protocol/skills/squad-human-step-wizard.md
     Rebuild: node scripts/build.mjs   ·   Verify: node scripts/build.mjs --check -->

# Human-step wizard: when the step really is his

CLI-first is not negotiable (Section 7): a step a tool can execute is executed by that tool, and handing it to the Founder is an orchestration failure. Some steps are human by nature, though. A key exists only behind a third party's login. A consent screen wants a person's click. A cutover is the Founder's to perform. For those, the squad does not hand him a numbered list to follow by hand and report back on. It hands him a script that walks him through the step and proves each stage as it goes. Adapted, with attribution, from Matt Pocock's `wizard` skill (MIT).

## First, prove it is human

Before writing anything, establish that no CLI or API does the step. If that is not obvious, it is a question about an external system, so it goes to the Integration Engineer and comes back as a fact with a source. A wizard written for a step `gh`, the provider's CLI or a documented API could have done is the manual step this squad refuses, only with better formatting.

## What the wizard is

A shell script **the Founder runs**, so it is the one interactive command in a squad whose own commands never prompt. Its contract:

- **One stage per step, in dependency order,** each with its number out of the total, so he always knows how much is left. A stage holds one focused task, so nothing he needs scrolls away.
- **It opens the page before asking for what is on it,** and says exactly where to click and what to copy, in his language, as everything addressed to him is.
- **A secret is entered hidden and goes only where it belongs:** the gitignored env file, or the CI secret store through its CLI, read from standard input. It is never a command argument, which would put it in the shell history and the process list. It is never echoed, logged or summarised. Writes are idempotent, so a second run replaces a value and never duplicates it.
- **Every stage ends with a check, not a question.** After he acts, the script runs the command that proves the stage landed: the secret store lists the name, the endpoint answers, the DNS record resolves. "Did you do it? (y/n)" is self-reporting, and this squad does not accept self-reporting as proof.
- **An irreversible stage stops and confirms,** and only runs when its gate 3 is already on record. The wizard is how a decided step gets carried out. It never takes the place of the decision.
- **It closes with a summary:** what was written and where, by name and never by value, and what was skipped and why.

## Authoring

1. **Scope from the repository, not from him.** Every value CI reads (`secrets.*`, `vars.*`), every key in the env example file, every service the stack table names. Each value needs three answers: where he gets it, where it is written, and whether it is secret.
2. **Map each stage to concrete steps a stranger could follow.** Where the current screen or command is not known, it is a fact for the Integration Engineer. A stage that invents a menu he will not find is worse than no stage.
3. **Verify without running it.** `bash -n`, `shellcheck` where it is installed, and a static trace showing that every value from step 1 is captured and lands where step 1 said. Every secret name it sets must match a `secrets.*` reference in CI exactly, and that is a comparison, so run it. Never run the wizard yourself: it opens a browser and waits for a person.

## Where it lives

- **Ephemeral by default.** It is written outside the repository for one run and deleted when the run is confirmed.
- **A repeatable setup path is committed** under the project's scripts and linked from its README, so the next environment runs the script instead of asking anyone. Committing it is a change like any other.
- **The Invoker hands it over.** The Founder receives one line, the command to run, with the reason the step is his. He never receives the script's body or a request to paste a value into the chat.
