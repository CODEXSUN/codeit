process.on("message", (message) => {
  if (message?.type === "codeit:shutdown") process.exit(0);
});
process.once("disconnect", () => process.exit(0));
await import("../node_modules/vite/bin/vite.js");
