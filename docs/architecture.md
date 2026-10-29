# Codeit architecture

## Status and scope

Codeit is a local React and Fastify application. This document records current boundaries and target rules. It does not claim that the code already enforces every rule.

## Module ownership

| Module | Owns | Current evidence |
| --- | --- | --- |
| Project settings | Project identity, folder, requested access and approval settings | `api/src/project-settings.ts`, `api/src/store.ts` |
| Conversation | Chat history, provider binding, Codex events and approval requests | `api/src/chat.ts`, `api/src/store.ts`, `web/src/conversation.tsx` |
| Project work | Idea, approved plan, task state, run evidence and review decisions | `api/src/loop-store.ts`, `api/src/loop-runner.ts`, `api/src/loop-routes.ts`, `web/src/project-loop.tsx` |
| Supervisor | Project supervisor conversation, approval requests, and persisted status | `api/src/supervisor.ts`, `api/src/supervisor-store.ts`, `api/src/supervisor-routes.ts` |
| Documentation | Read-only access to configured Markdown sources and inert presentation | `api/src/docs-source.ts`, `api/src/docs-routes.ts`, `web/src/docs-workspace.tsx` |
| Provider integration | Codex transport and Gemini requests | `api/src/codex-rpc.ts`, `api/src/gemini.ts`, `api/src/providers.ts` |
| Local shell | API composition, access checks and startup | `api/src/server.ts`, `tools/preflight.mjs` |

See [agent rules](agent-rules.md) and the [module contract template](templates/module-contract.md) before adding a module. New boundaries require explicit contracts and tests. Existing shared files are not proof of independent modules.

## Domain and dependency rules

A project is the local workspace context. A chat belongs to a project. Project work owns its idea, plan, task transitions, and evidence. A provider runs a turn but does not own the task state.

The API composes modules. The web layer uses API contracts. A module must not read or mutate another module's storage directly as a target design. Name public commands, queries and events in a contract. Do not claim this rule is enforced until tests or tooling prove it.

Use domain terms consistently. Keep validation and transition decisions in the owner. Avoid adding infrastructure or another service solely to represent a module.

## Events and evidence

Codeit already records chat and task-run events. Chat events also stream to the browser. Loop run events are stored in SQLite within the loop document. These are implementation records, not a general event bus, transactional outbox, or replay guarantee.

Ordinary chat approval evidence records a request ID and method, a person's decision, and interruption or response-queued status. It does not store approval parameters. A queued response does not prove that Codex received or executed it. The chat API exposes the evidence in its event history. The conversation view does not currently render those evidence records.

For a new domain event, define its owner, name, version, payload, ordering, durability, consumers, and failure behavior. Define idempotency and recovery before any consumer takes consequential action. Persist an event atomically with its state change when the contract requires durable delivery. Do not claim exactly-once delivery without evidence.

## Supervisor and documentation

The supervisor uses a separate project conversation. It can propose work, but the user must approve and start tasks through project work controls. Its read-only setting does not confine reads to the project folder. A saved supervisor thread requires its original folder and approval setting for follow-up turns.

The documentation API uses two configured source roots. It lists and reads Markdown and MDX under those roots. The viewer treats MDX as inert content. Assist rules remain outside those roots and are not viewable there. Root containment is a documentation access rule, not Codex read isolation.

## Task lifecycle

The current loop requires a saved idea and approved plan before a worker starts. Dependencies must be accepted. Worker completion leads to review. A separate read-only Codex thread can provide review evidence. A person can also record a manual review of the latest completed worker run. The record includes a self-reported reviewer, scope, omissions, findings, approved settings, and time. A person separately accepts the task or requests changes. Failed and interrupted runs retain their status and can be retried according to the API transition rules.

The plan pins the folder and requested permissions. Codeit checks these settings when starting and resolving work. The selected folder is a working directory, not a read-isolation boundary. Read-only Codex can read outside that folder. Operating-system write isolation has not been independently verified. Review output is evidence, not an independent guarantee of correctness.

## Persistence and integration limits

The stores persist domain documents in SQLite under `CODEIT_DATA_DIR` or `.codeit`. The chat store batches streaming deltas and flushes at shutdown. Loop and supervisor stores retain run and approval evidence. See [SQLite storage](storage.md) for import and recovery.

No distributed event broker, cross-module authorization layer, or independently verified sandbox boundary is established by this document. Use disposable fixtures to test transitions, approvals, failure and restart. See the [verification template](templates/verification.md).
