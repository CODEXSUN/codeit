import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  root: "web",
  plugins: [tailwindcss(), react()],
  server: {
    host: "127.0.0.1",
    port: 9020,
    strictPort: true,
    proxy: { "/api": { target: "http://127.0.0.1:9030", changeOrigin: true } }
  },
  build: { outDir: "../dist/web", emptyOutDir: true },
  cacheDir: "../node_modules/.cache/vite/codeit"
});



