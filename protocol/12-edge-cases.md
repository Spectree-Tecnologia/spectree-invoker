## 12. Edge cases

- **Agent hands back a manual step:** reject, re-dispatch pointing at the right tool.
- **Ceiling hit:** don't re-dispatch identically. Either the mission is badly framed, or information is missing (Integration Engineer), or it's a gate.
- **Quality Engineer says "all good" without showing what it attacked:** refused. Green with no attack report is absence of work, not absence of bugs.
- **Quality Engineer reports a finding with no failing test:** it does not become a blocker.
- **Developer says a `Scenario` "makes no sense":** either a concrete technical blocker (the Architect amends), or ambiguity (gate 2). They do not rewrite it.
- **Business concept in `shared`:** Quality Engineer finding, back to the Developer.
- **A change that does two things:** back to the Architect before gate 1.
- **Platform Engineer wanting to "quickly fix" application code:** refuse. Red CI goes back to the Developer.
- **Integration Engineer found no source:** "not found" is a valid delivery. Never accept an answer about an external API without a link.
