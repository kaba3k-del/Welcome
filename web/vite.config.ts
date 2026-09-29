import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
export default defineConfig({
  plugins: [
    react(),
    {
      name: "welcome-versioned-service-worker",
      closeBundle() {
        const html = readFileSync("dist/index.html", "utf8"),
          hash = createHash("sha256").update(html).digest("hex").slice(0, 16);
        const sw = readFileSync("dist/sw.js", "utf8").replace(
          "welcome-shell-v1",
          "welcome-shell-" + hash,
        );
        writeFileSync("dist/sw.js", sw);
      },
    },
  ],
  server: { proxy: { "/api": { target: "http://localhost:8787", ws: true } } },
});
