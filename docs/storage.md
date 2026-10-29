# SQLite storage

Codeit stores projects, chats, loops, and supervisors in `CODEIT_DATA_DIR/codeit.sqlite`. The default data directory is `.codeit`. SQLite is the source of truth after import. The old JSON files are not updated.

The domain stores keep their current document shapes. The SQLite adapter uses Kysely's SQL compiler to build parameterized queries and Node's synchronous SQLite driver to execute them. It does not use an interchangeable Kysely execution driver. A schema version controls database migrations. Each document write uses a revision check. A stale writer fails instead of replacing a newer document. The API uses a lock file to prevent a second Codeit process from using the same directory. Other programs must not write to this database.

## Import existing JSON

1. Stop all Codeit servers and older Codeit processes that use the data directory.
2. Set `CODEIT_DATA_DIR` to the existing data directory if it is not `.codeit`.
3. Run `npm run storage:import-json` from the repository root.
4. Start Codeit with `npm run dev`.
5. Check the projects, chats, settings, loops, and supervisor histories.

The import validates all present `data.json`, `loops.json`, and `supervisors.json` files. It copies them to `json-backup-v1` and verifies their hashes. It inserts the documents and import marker in one SQLite transaction. It does not remove or rewrite the source files. A repeat with the same source files reports that the import is complete. A changed source or a nonempty database causes the import to stop. Missing files remain missing and receive the normal empty defaults when used.

The import cannot detect a running older JSON-based server. Stop every older process before import. On startup, Codeit checks the legacy files against the import manifest. It refuses startup if a file appeared, changed, or disappeared. It does not merge the files. Preserve both copies and investigate the difference. Keep an independent backup before changing production data. The backup and database can contain private conversations and settings. Protect their directory and do not commit them.

## Failure and recovery

The API refuses to start with legacy JSON until an import marker exists. A failed import leaves the JSON sources and any verified backup in place. A failed database transaction rolls back. Fix the reported cause and retry with the same source files. If an existing backup differs, preserve both copies and investigate before retrying. If a prior database already has documents, the import will not merge or overwrite them.

The lock file is `codeit-storage.lock` in the data directory. A normal exit removes it. A crash or forced termination can leave it behind. Verify that no Codeit or import process uses the directory before manually removing a stale lock. Do not remove an active lock.

After a storage write fails, that store refuses further operations. The API reports the failure and starts shutdown. Streaming deltas can remain in memory for up to 500 milliseconds. A failed flush or forced stop can lose those unflushed deltas. Restart recovery marks unfinished loop and supervisor runs as interrupted.

To return to the JSON-based version, stop Codeit and preserve the SQLite database and its journal. Restore the JSON backup to a separate data directory and point the older version there. The backup only contains data from the time of import. It does not include later SQLite changes. There is no SQLite-to-JSON export or automatic rollback.

SQLite files use owner-only mode where the operating system supports it. Windows access also depends on the directory ACL. MariaDB is not implemented. A future adapter must define its transaction, concurrency, and migration behavior before use.
