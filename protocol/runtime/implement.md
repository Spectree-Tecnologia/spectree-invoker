# Implementation phase

Implement the task's approved behavior through its existing public interfaces.
Read the task's spec references and module conventions, then use small vertical
cycles. The independent acceptance contract is already established by QA pass 1;
do not rewrite it. Preserve existing behavior and avoid speculative abstractions.

Run focused checks while working. An assertion expectation comes from the contract
or an independently worked example, never a duplicate of the implementation;
`squad-test-quality` says where a test goes and what it may fake.
If a check is ambiguous or appears wrong, report the concrete counterexample.
Never mutate active source temporarily to demonstrate a test; use the disposable
mutation probe. Stop on a missing dependency or out-of-scope change.

Your final message ends with one line holding only the packet's result_contract
JSON object (`spectree_result: 1`, status, reason), never prose after it. Use
blocked for unavailable tools and interrupted for quota/cancellation.
Do not label a finished turn as delivered work. Only the executor's acceptance
checks can verify the candidate. Preserve failures and inspected evidence on retry.
