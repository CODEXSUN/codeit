# Release commands

Run `npm run version:bump -- --title "Release title"` to bump the patch version and add a changelog entry. The command checks Git changes for database files. Use `--database-update` or `--no-database-update` to set the database result explicitly.

Run `npm run changelog:append -- --title "Entry title" --note "Change description" --database-update No` to add an entry to the current version.

Run `npm run github:now -- --dry-run` to review the current subject and changed files. Without `--dry-run`, the command asks before Git actions. The review lists individual untracked files and refreshes the staging scope before confirmation. It compares temporary Git trees before installing the reviewed index. Review the file list and ignore rules before continuing. Concurrent Git operations can change the index after review. Commit hooks can also change staged content before commit. The command checks the committed tree against the reviewed tree and does not push a mismatch. If a mismatch occurs, inspect the commit, hooks, and index. Resolve it manually before proceeding. Avoid concurrent Git operations. A version bump happens when selected, even if a later Git confirmation is declined. With no upstream, the command asks separately before a local commit and does not fetch or push. With an upstream, it asks separately before pull and push.

Run `npm run env:jwt-secret` to replace or add `JWT_SECRET` in an existing `.env`. The command does not print the value. It does not configure Codeit authentication. Startup loads the root `.env`; existing environment variables take precedence. Set Gemini keys as described in the README.
