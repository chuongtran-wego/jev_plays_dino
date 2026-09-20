import { defineConfig } from "vite";

export default defineConfig({
  root: "web",
  server: {
    host: "0.0.0.0",
    allowedHosts: ["terminal.local"]
  },
  build: {
    outDir: "../dist",
    emptyOutDir: true
  }
});
