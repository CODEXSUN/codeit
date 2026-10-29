import { lstatSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
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
