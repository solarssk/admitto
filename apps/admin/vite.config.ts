import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const rootVersion = (
  JSON.parse(readFileSync(resolve(__dirname, "../../package.json"), "utf-8")) as { version: string }
).version;

export default defineConfig({
  plugins: [react()],
  base: "/",
  define: {
    __APP_VERSION__: JSON.stringify(rootVersion),
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:3000",
      "/login": "http://localhost:3000",
      "/logout": "http://localhost:3000",
      "/mfa": "http://localhost:3000",
      "/healthz": "http://localhost:3000",
    },
  },
});
