## ADDED Requirements

### Requirement: Registered specialist consultation
Presence SHALL route a consultation to the eligible canonical specialist role selected in the request.

#### Scenario: Each registered role receives its own context
- **GIVEN** the six canonical squad roles and a policy enabling the selected role
- **WHEN** a consultation is admitted for that role
- **THEN** its dedicated Codex session receives that role's fixed conversational profile and the supplied context, with a distinct participant identity.

#### Scenario: Unknown or ineligible role
- **GIVEN** a role absent from the registry or TypeSafe without server-side eligibility
- **WHEN** a consultation is requested
- **THEN** `E_SQUAD_ROLE` or `E_SQUAD_INELIGIBLE` is returned before any specialist session starts.

### Requirement: Bounded consultation contract
Presence SHALL reject consultation input or output outside its server-owned contract.

#### Scenario: Caller attempts to supply execution authority
- **GIVEN** a request containing a path, system prompt or unrecognized context field
- **WHEN** the request is validated
- **THEN** it is refused without starting a session.

#### Scenario: Invalid public result
- **GIVEN** a completed specialist turn returning invalid JSON, extra fields or excessive public text
- **WHEN** its result is processed
- **THEN** the delegation fails with `E_SQUAD_RESULT`, without publishing the result or retrying.

### Requirement: Consultation isolation
Presence SHALL retain the existing restricted ephemeral Codex policy for specialist consultations.

#### Scenario: Restricted specialist session
- **GIVEN** an eligible specialist consultation
- **WHEN** its session starts
- **THEN** it uses local ChatGPT authentication, an empty temporary directory, read-only sandbox, no network or environments, and disabled tools/MCP.

#### Scenario: Specialist attempts a tool
- **GIVEN** a running specialist session
- **WHEN** it emits an unsupported tool item
- **THEN** the consultation fails without publishing tool arguments or claiming completion.

### Requirement: Idempotent owned delegation
Presence SHALL execute at most one consultation for each accepted request identity.

#### Scenario: Repeated request
- **GIVEN** an admitted or completed consultation
- **WHEN** its identical request is received again
- **THEN** its existing delegation is returned without another turn.

#### Scenario: Conflicting request or concurrent work
- **GIVEN** an existing request identity or an active consultation
- **WHEN** different work reuses that identity or another consultation is requested
- **THEN** `E_REQUEST_CONFLICT` or `E_SQUAD_BUSY` is returned without another session.

### Requirement: Attributed public delegation state
Presence SHALL publish only validated results and ordered lifecycle events attributed to the owning session, role and participant instance.

#### Scenario: Confirmed completion
- **GIVEN** a matching specialist thread and turn with a valid public result
- **WHEN** the turn completes successfully
- **THEN** the snapshot contains its result and monotonically sequenced events, without private thread IDs, credentials or reasoning.

#### Scenario: Successive roles and repeated instances
- **GIVEN** successive Developer, Quality and Developer consultations
- **WHEN** an earlier instance emits a late result
- **THEN** each current instance retains its own context and result; the old notification cannot overwrite it.

### Requirement: Owned cancellation
Presence SHALL retain cancellation ownership until the specialist reaches a terminal state or its owned session is disconnected after the bounded cancellation wait.

#### Scenario: Cancel before the turn start acknowledgement
- **GIVEN** a consultation waiting for its start acknowledgement
- **WHEN** cancellation is requested
- **THEN** cancellation remains pending until an interruptible turn is known or the owned session is disconnected, without publishing a late result.

#### Scenario: Interrupt acknowledgement without completion
- **GIVEN** an interrupt acknowledgement without a terminal notification
- **WHEN** the cancellation wait expires
- **THEN** only the owned session is disconnected and the delegation is cancelled without accepting its result.

#### Scenario: Session replacement, deadline or lost contact
- **GIVEN** an active consultation
- **WHEN** its owner changes, its deadline expires or its client lease expires
- **THEN** its work is cancelled and stale results are discarded without closing a replacement specialist session or exposing the previous owner's history.

### Requirement: Opt-in local textual delegation
Presence SHALL expose P4.1 consultations only through its authenticated local opt-in textual service.

#### Scenario: Authenticated canary action
- **GIVEN** a server launched with `--codex --squad`
- **WHEN** a same-origin authenticated delegation or cancellation action is submitted
- **THEN** the bounded action is handled and the snapshot exposes the six-role registry and actual delegation state.

#### Scenario: Unauthorized, mixed mode or duplicate generic action
- **GIVEN** a missing token, foreign origin, audio mode, active specialist or reused generic request ID
- **WHEN** an incompatible action is attempted
- **THEN** it is refused without duplicated Invoker/specialist work or an audio API call.
