import { closeSync, lstatSync, openSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";

export type DocsRoot = { id: string; label: string; folder: string };
const excluded = new Set(["node_modules", "dist", "build", "coverage", "vendor", "target"]);
const allowed = /\.(md|mdx)$/i;

export class DocsSource {
  constructor(private readonly roots: DocsRoot[]) {}
  list() {
    const roots: { id: string; label: string }[] = [];
    const files: { root: string; path: string }[] = [];
    for (const source of this.roots) {
      let root: string;
      try { root = realpathSync(source.folder); if (!statSync(root).isDirectory()) continue; } catch { continue; }
      roots.push({ id: source.id, label: source.label });
      this.walk(root, root, source.id, files, 0);
    }
    return { roots, files };
  }
  read(id: string, path: string) {
    const source = this.roots.find((item) => item.id === id);
    if (!source || !path || isAbsolute(path) || !allowed.test(path) || path.split(/[\\/]/).some((part) => !part || part.startsWith(".") || excluded.has(part.toLowerCase()))) throw new Error("Invalid documentation path.");
    const root = realpathSync(source.folder);
    const target = resolve(root, path);
    const segments = relative(root, target);
    if (!segments || segments === ".." || segments.startsWith(`..${sep}`) || isAbsolute(segments)) throw new Error("Invalid documentation path.");
    let current = root;
    for (const segment of segments.split(sep)) { current = resolve(current, segment); if (lstatSync(current).isSymbolicLink()) throw new Error("Symbolic links are not allowed."); }
    const actual = realpathSync(target);
    const inside = relative(root, actual);
    if (!inside || inside === ".." || inside.startsWith(`..${sep}`) || isAbsolute(inside)) throw new Error("Invalid documentation path.");
    const info = statSync(actual);
    if (!info.isFile() || info.size > 256 * 1024) throw new Error("Documentation file is unavailable or exceeds 256 KiB.");
    return { root: id, path: segments.split(sep).join("/"), content: readFileSync(actual, "utf8") };
  }
  create(id: string, name: string, content: string, kind: "document" | "rule") {
    const source = this.roots.find((item) => item.id === id);
    if (!source || (kind === "rule" && id !== "codeit")) throw new Error("Destination is not allowed.");
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,119}\.md$/.test(name) || (kind === "rule" && !name.startsWith("rule-"))) throw new Error("Use a simple Markdown filename; rules must start with rule-.");
    if (Buffer.byteLength(content, "utf8") > 256 * 1024) throw new Error("Document exceeds 256 KiB.");
    const root = realpathSync(source.folder);
    if (!statSync(root).isDirectory()) throw new Error("Documentation destination is unavailable.");
    const target = resolve(root, name);
    let fd: number;
    try { fd = openSync(target, "wx", 0o600); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new Error("A file with that name already exists. Choose another name.");
      throw new Error("Could not create the document in the selected destination.");
    }
    try { writeFileSync(fd, content, "utf8"); }
    catch { throw new Error("Document write failed. A new incomplete file may remain; inspect the destination before retrying."); }
    finally { closeSync(fd); }
    return { root: id, path: name };
  }
  private walk(root: string, folder: string, id: string, files: { root: string; path: string }[], depth: number) {
    if (depth > 8 || files.length >= 1000) return;
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      if (files.length >= 1000) break;
      if (entry.name.startsWith(".") || excluded.has(entry.name.toLowerCase()) || entry.isSymbolicLink()) continue;
      const path = resolve(folder, entry.name);
      if (entry.isDirectory()) this.walk(root, path, id, files, depth + 1);
      else if (entry.isFile() && allowed.test(entry.name)) files.push({ root: id, path: relative(root, path).split(sep).join("/") });
    }
  }
}
