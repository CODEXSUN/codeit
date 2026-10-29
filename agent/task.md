# Task workflow

Read [Codeit agent rules](../docs/agent-rules.md) and the [shared agent guide](../../../assist/AGENT.md) before work. Identify the owner and preserve existing changes.

## Project work in Codeit

1. Select a project with a configured folder and permissions.
2. Save an idea and a plan with tasks and acceptance criteria.
3. Approve the saved plan before starting a worker.
4. Accept dependency tasks before starting dependent work.
5. Start a worker explicitly and inspect its status and evidence.
6. Request review after the worker completes.
7. Inspect the review and accept the task or request changes.

The supervisor can suggest work. Its suggestions do not approve a plan or start a task. Only one project worker or review runs at a time. A failed or interrupted run retains its status. Retry through the available task controls.

The project folder is a working directory. It does not confine reads. A separate read-only Codex thread performs review, but the result is not independent verification. Report the evidence and any untested behavior. See [architecture](../docs/architecture.md) and the [verification template](../docs/templates/verification.md).
