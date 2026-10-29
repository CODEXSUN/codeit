# Ideas module contract

Project work owns ideas and the handoff to the project loop. Docs owns document creation and reading.

## Storage and commands

Ideas use the `ideas` document in the existing SQLite `documents` table. The document format has version 1. A new installation starts with an empty version 1 document. Existing databases need no SQL schema change for this document. A version 0 document migrates to version 1 after its data passes validation. Unknown versions fail validation. A future format change must add an explicit versioned migration and preserve the old data on failure.

Each idea has a stable ID, project ID through its containing collection, stage, and revision. Updates require the current revision. A stale update fails. The repository also checks the document revision on write. The storage lock remains the boundary against multiple Codeit servers using one data directory.

The project Ideas API lists, creates, reads, edits, and changes the stage of ideas. The project must exist. The loop handoff copies a saved idea and its ID only when project work is empty. It does not approve a plan or start a worker. Project work owns plan approval, tasks, and run evidence. Users must save and approve a plan before starting work.

Plan refinement sends the current plan summary to the selected Codex model only after a user action. Prompt Manager records the exact submitted prompt before the provider call. The returned proposal is not stored automatically. The user may edit the proposal and choose to place it in the plan draft or add it as a task draft. Saving and approving the plan remain separate actions. Codex availability and supported model settings are checked at request time. Gemini is not supported for this action. A repeated attempt ID is not sent again. The user can start a new attempt after a failure.

## Documentation handoff

Docs accepts a root ID, simple Markdown filename, content, and document or rule kind. It creates a new file with exclusive creation. It does not replace existing files. Rules use the Codeit root and a `rule-` filename. A rule document does not enforce a rule. The source idea is unchanged. If a write fails after creation, an incomplete file can remain and needs inspection.

Docs treats Markdown and MDX as inert content. The viewer disables images and links. Handoff creates Markdown files only. The allowed roots are Codeit documentation and the configured CODEXSUN workspace documentation folder when present. These roots are shared across projects, not project-specific folders.

## Access and recovery

The API listens on loopback and checks Host, Origin when present, and a custom header for writes. These checks help restrict browser access. They do not authenticate local processes or provide an operating-system security boundary. A local process can call the API and read or write data available to the Codeit process.

The browser keeps an unsaved idea draft in session storage for the current tab. A reload in the same tab can restore it. Tab closure, disabled storage, or browser data clearing can discard it. Saved ideas remain in SQLite. The draft can contain sensitive text and is available to scripts in that browser origin.

Do not log idea content, provider inputs, provider output, or credentials. Provider failures return a general error. A failed storage write stops further writes and requires investigation and restart. See [SQLite storage](storage.md).
