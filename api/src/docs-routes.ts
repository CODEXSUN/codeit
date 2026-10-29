import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";
import { DocsSource } from "./docs-source.js";
import { resolveFolder } from "./project-settings.js";
import { Store } from "./store.js";

export function registerDocsRoutes(app: FastifyInstance, projects: Store) {
  const docs = new DocsSource([
    { id: "codeit", label: "Codeit documentation", folder: fileURLToPath(new URL("../../docs", import.meta.url)) },
    { id: "workspace", label: "CODEXSUN workspace documentation", folder: "D:/codexsun/docs/codeit" },
  ]);
  type Params = { id: string };
  app.get<{ Params: Params }>("/api/projects/:id/folders", async (req, reply) => {
    const project = projects.project(req.params.id);
    if (!project) return reply.code(404).send({ error: "Project not found." });
    if (!project.settings) return reply.code(409).send({ error: "Set the project folder first." });
    try {
      const root = resolveFolder(project.settings.folder);
      const folders = readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory() && !entry.isSymbolicLink() && !entry.name.startsWith(".") && !["node_modules", "dist", "build", "vendor"].includes(entry.name.toLowerCase())).map((entry) => ({ name: entry.name }));
      return { root, folders };
    } catch { return reply.code(400).send({ error: "Project folder is unavailable." }); }
  });
  app.get<{ Params: Params }>("/api/projects/:id/docs", async (req, reply) => {
    if (!projects.project(req.params.id)) return reply.code(404).send({ error: "Project not found." });
    try { return docs.list(); } catch { return reply.code(500).send({ error: "Could not list documentation." }); }
  });
  app.get<{ Params: Params; Querystring: { root?: string; path?: string } }>("/api/projects/:id/docs/file", async (req, reply) => {
    if (!projects.project(req.params.id)) return reply.code(404).send({ error: "Project not found." });
    try { return docs.read(req.query.root ?? "", req.query.path ?? ""); }
    catch { return reply.code(400).send({ error: "Documentation file is unavailable or not allowed." }); }
  });
}
