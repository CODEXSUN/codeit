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
- Added vertical Settings navigation with keyboard tabs and responsive mobile stacking.
- Added separate Codex and Gemini Settings pages with independent one-time connection checks.
- Simplified provider pages and added a full-height Settings separator.
- Added a Windows PATH-first local Codex executable fallback when the app path is unambiguous.
- A fresh empty-PATH process found Codex and its models. The existing live API has not loaded this fix.
- The local executable signature is not verified. Gemini live use remains untested without an environment key.
- Codex identity uses permitted account data. Gemini uses an environment key and has no identity display or local provider.
- Live Codex discovery and mocked provider tests passed. Gemini credentials were absent; browser and restart checks remain pending.
- Isolated desktop and mobile checks covered each section and keyboard navigation. Screen-reader testing remains open.
- Added project-scoped Prompt Manager records and append-only revisions for provider attempts.
- Captured chat, supervisor, worker, review, and chat or plan refinement prompts before provider calls.
- Stored text and OCR attachments; image data URLs are represented by SHA-256 hashes.
- The local API has no user identity, outcome proof, or historical backfill. Lists return up to 500 records.
- Retry deduplication does not survive reload. Browser fixtures covered capture, revision, and restart.
- Added project-scoped Ideas with versioned editing, stages, Markdown preview, and session draft recovery.
- Added explicit handoff to empty project work, reviewable Codex refinement, and new-file Docs and Rule handoff.
- Ideas uses local access controls, which do not authenticate local processes. Gemini plan refinement is not supported.
- Session draft recovery depends on same-tab browser storage. Rule documents are not automatically enforced.
- A disposable browser fixture tested real Codex refinement, explicit task draft creation, and prompt capture.
- Independent testing confirmed draft preservation, one prompt record, and duplicate-request rejection.
- An integrated disposable test covered Codex chat, prompt records, Ideas handoff, settings, and restart.
- Provider dispatch count was not independently measured. Direct Windows symlink testing remains unavailable.
- Filtered Codex usage, events, approvals, and completion by turn ID to reject stale events.
- Independent tests covered stale events and early approvals. An isolated resumed-chat test showed fresh usage and context continuity.
- Persisted local turn timing for Codex and Gemini, including observed failure and interruption times.
- Gemini timing has mock coverage only. The live API restart for preference routes remains pending.
- Added a retry path for an unavailable chat API that preserves the draft in tested failures.
- Added Codex thread ID copy after a read-only binding check, with CLI resume guidance.
- Added linked-chat name comparison, a persisted baseline, conflict classification, and explicit resolution.
- Resolution shows a preview, requires confirmation, checks names before and after, and warns on partial failure.
- Isolated UI tests covered both directions, conflicts, cancellation, restart, mobile, and keyboard use.
- A fresh disposable chat test confirmed explicit naming and the same desktop-resolved thread and title.
- Codex name updates have no compare-and-swap. A concurrent rename can still be overwritten without detection.
- No automatic Codex name writes occur. Live fault injection and screen-reader tests remain open.
- A disposable fixture checked clipboard copy and duplicate rejection. Independent inspection confirmed thread and prompt records.
- Clipboard denial, concurrent live lookup, and URI navigation remain unverified. Desktop direct-send is not implemented.
- Rendered assistant Markdown and GFM as inert content, including literal angle-bracket placeholders.
- Added an approval jump when the pending request is outside the visible chat area.
- A narrow-screen fixture verified the approval jump. Screen-reader announcements remain unverified.
- Tested persisted server timestamps across replay and crash. Gemini timing has not been tested live.

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
