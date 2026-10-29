# Changelog

Current version: 1.0.2
Release tag: v-1.0.2
Changelog label: v 1.0.2

## v-1.0.2

### [v 1.0.2] 2026-10-29 04:49 pm - Chat activity and workspace updates

#### Database Changes

- Database update: Yes.

#### App Codebase Changes

- Bumped workspace version to 1.0.2.
- Added expandable chat activity for reported commands, file changes, searches, tools, and compaction.
- Tested real command, file-change, and web-search events in a disposable browser fixture.
- Replayed real manually requested compaction events in the fixture. Automatic compaction remains unverified.
- Added provider preferences and Settings updates described in the previous entry.

## v-1.0.1


### [v 1.0.1] 2026-10-29 03:45 pm - Codeit workspace and persistence

#### Database Changes

- Added SQLite storage with versioned schema, revision checks, and a data directory lock.
- Added an offline JSON import with validation, verified backups, and transactional import.
- Imported existing live JSON data after backup and integrity checks. Interrupted backups may require manual investigation.
- Buffered streaming updates may be lost after a failed flush or forced stop.

#### App Codebase Changes

- Added project chat, task planning and review, supervisor handoff, and a read-only documentation viewer.
- Added provider and model selection, attachments, OCR, voice input, and draft preservation.
- Added sanitized Codex discovery failure categories and unavailable status for empty model lists.
- Removed exact duplicate streamed messages from worker-review prompts while retaining review evidence.
- Added provider-reported Codex usage display and a gate for usage replay before a resumed turn.
- Live testing also observed stale usage after resume. Turn-ID filtering is in progress.
- Token savings are not quantified. Manual-review recovery remains in progress.
- Added workspace, project, and chat provider preferences with SQLite revision checks and inheritance.
- Added provider status tests and settings access from the workspace rail and project menu.
- Isolated UI tests covered preference overrides, inheritance, restart, and Codex availability.
- Gemini live use and credential-manager integration remain untested or unavailable. Gemini requires a server environment key.
- Theme remains light-only. Connectors are not configurable, and removed-chat preferences are not automatically cleaned.
- Added split and combined local startup, environment configuration, and safe shutdown controls.
- Added port takeover with listener checks and a guard for combined-supervisor sibling services.
- Forced stops can lose buffered work. A final PID reuse race remains possible.
- Added release, changelog, Git review, and JWT secret generation commands.
- Added task, planning, and skills guides linked from the Rule Book.
- Gemini was tested with mocks. Microphone input and operating-system file drag remain unverified.
- Read-only settings do not establish read confinement or prove operating-system write isolation.
- MariaDB storage and SQLite-to-JSON export are not implemented.


### [v 1.0.1] 2026-10-29 - Initial Codeit release

#### Database Changes

- Database update: No.

#### App Codebase Changes

- Established the initial Codeit release version.
