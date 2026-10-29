import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { DocsSource } from "../api/src/docs-source.js";

test("documentation stays in configured roots and returns MDX as text", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "codeit-docs-test-"));
  const root = join(dir, "docs"); mkdirSync(root); mkdirSync(join(root, "node_modules"));
  writeFileSync(join(root, "guide.mdx"), "<script>not executed</script>");
  writeFileSync(join(root, "secret.txt"), "not a document");
  writeFileSync(join(root, "node_modules", "hidden.md"), "hidden");
  writeFileSync(join(dir, "outside.md"), "outside");
  try {
    const docs = new DocsSource([{ id: "test", label: "Test", folder: root }]);
    assert.deepEqual(docs.list().files, [{ root: "test", path: "guide.mdx" }]);
    assert.equal(docs.read("test", "guide.mdx").content, "<script>not executed</script>");
    assert.throws(() => docs.read("test", "../outside.md"));
    assert.throws(() => docs.read("unknown", "guide.mdx"));
    assert.throws(() => docs.read("test", "secret.txt"));
    try { symlinkSync(join(dir, "outside.md"), join(root, "linked.md"), "file"); }
    catch { t.diagnostic("Symlink creation unavailable; direct symlink case not exercised."); }
    assert.throws(() => docs.read("test", "linked.md"));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("handoff creates only new files under permitted roots", () => {
  const dir = mkdtempSync(join(tmpdir(), "codeit-handoff-"));
  try {
    const docs = new DocsSource([{ id: "codeit", label: "Codeit", folder: dir }, { id: "workspace", label: "Workspace", folder: dir }]);
    assert.deepEqual(docs.create("codeit", "idea.md", "original", "document"), { root: "codeit", path: "idea.md" });
    assert.throws(() => docs.create("codeit", "idea.md", "overwrite", "document"), /already exists/);
    assert.equal(readFileSync(join(dir, "idea.md"), "utf8"), "original");
    for (const name of ["../escape.md", "a/b.md", "a\\b.md", ".hidden.md", "thing.mdx"]) assert.throws(() => docs.create("codeit", name, "x", "document"));
    assert.throws(() => docs.create("workspace", "rule-test.md", "x", "rule"));
    assert.throws(() => docs.create("codeit", "test.md", "x", "rule"));
    docs.create("codeit", "rule-test.md", "<script>inert</script>", "rule");
    assert.equal(docs.read("codeit", "rule-test.md").content, "<script>inert</script>");
    assert.throws(() => docs.create("codeit", "large.md", "a".repeat(256 * 1024 + 1), "document"));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
