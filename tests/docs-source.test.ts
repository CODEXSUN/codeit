import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
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
