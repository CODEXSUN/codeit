import { loadConfig } from "./config.mjs";
import { importLegacy } from "../api/src/import-json.js";

loadConfig();
try { console.log(`SQLite import: ${importLegacy()}.`); }
catch (error) { console.error(error instanceof Error ? error.message : "SQLite import failed."); process.exitCode = 1; }
