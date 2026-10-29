# Prompt Manager contract

Prompt Manager owns prompt attempts and append-only revisions in `codeit.sqlite`. The API composes the module. The local Host and Origin checks and the `x-codeit-request` requirement apply to its routes. Codeit has no user identity or multi-user authorization. Project IDs scope the API queries. A local process with API or database access can read prompt contents.

## Capture

The chat and supervisor routes record an attempt before calling their provider path. Chat refinement records the input before the refinement call. Plan refinement records its composed provider prompt before the refinement call. Worker and review runs record the generated prompt immediately before `turn/start`. A saved attempt does not prove provider acceptance. An attempt can be present when setup fails, the provider fails, the user cancels, or the process stops. Outcomes are not currently stored in Prompt Manager. Check the originating chat or run history for available status evidence.

The original chat text is retained without rewriting. Text attachment content and image OCR are retained separately. Image data URLs are represented by a SHA-256 digest, not the image bytes. The digest identifies the submitted data URL representation. The module does not store provider credentials or provider configuration. The worker and review text can include earlier task evidence. Treat the whole record as sensitive.

A client request UUID identifies a chat, supervisor, chat-refinement or plan-refinement attempt. The same request ID and payload cannot dispatch twice through these routes. A repeated request gets a conflict and must be investigated in history. A client keeps the ID while its unchanged draft remains in the mounted view. A page reload or a changed draft creates a new ID, so retries across reloads are not deduplicated. Worker and review use the run ID. A new run is a new attempt. Records created before this feature are not backfilled.

`claim` takes project ID, request ID, source, optional chat ID, raw text and optional attachment data. It inserts the record and revision 1 in one transaction. It returns whether the claim is new. A repeated claim with different stored content or metadata fails. Plan refinement uses source `plan-refine` and rejects duplicate claims without another provider call.

## Queries and edits

The API lists up to 500 recent records per project and shows one reference and its revisions. It has no pagination. A revision request includes the expected revision and replacement text. It appends a revision and rejects stale writes. Editing the record does not change the original provider submission. SQLite triggers reject updates and deletes for records and revisions. Prompt Manager has no delete function.

## Storage and recovery

The module owns `prompt_schema` and its own tables inside `codeit.sqlite`. Module schema version 2 adds attachment data to version 1 records in a transaction. The shared SQLite `user_version` remains unchanged. Future module changes require forward migrations. A database with a newer module schema is rejected. Older Codeit versions do not expose these records. Legacy JSON import does not populate them.

Stop Codeit and back up the database and any journal together before upgrade or recovery. Protect the data directory and backups with operating-system permissions. Prompt text, attachment text, OCR and revisions may contain private data or secrets. Do not put credentials in prompts. The module does not silently redact submitted text. A storage failure blocks the affected submission before provider dispatch when it occurs during the audit claim. Investigate the database and preserve it before retrying. No automatic repair or deletion is provided.

## Verification and limits

Disposable tests cover reference uniqueness, retry conflicts, scope, append-only revisions, validation and restart. An isolated browser test exercised a real chat turn, a real chat refinement, a supervisor attempt, revision history and a database restart. Live worker capture, plan refinement through the browser, complete attachment handling through the browser, failure injection at each call site, and multi-process retry behavior require further verification. The local API boundary is not a user authentication system.
