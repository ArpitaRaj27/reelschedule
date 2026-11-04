import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const api = process.env.API_ORIGIN ?? "http://localhost:3001";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Same-origin in development: the browser talks to Vite, Vite forwards to the API.
    proxy: { "/api": { target: api, changeOrigin: false }, "/healthz": api },
  },
  build: { sourcemap: true, target: "es2022" },
  test: {
    environment: "jsdom",
    setupFiles: ["test/setup.ts"],
    include: ["test/**/*.test.{ts,tsx}"],
  },
});
