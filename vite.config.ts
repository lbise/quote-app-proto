import path from "node:path";
import { fileURLToPath } from "node:url";

import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

const appDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "app",
);

export default defineConfig({
  plugins: [tailwindcss(), reactRouter()],
  resolve: {
    alias: {
      "@": appDirectory,
    },
  },
  server: {
    host: "100.118.62.125",
    port: 5173,
    strictPort: true,
    allowedHosts: ["dev.voidstation.ch"],
  },
});
