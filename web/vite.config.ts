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
  // No source map in the production build (HW5 Task 6 decision): the map was 1.9 MB of original source,
  // comments included, downloadable by anyone, and no visitor's browser ever needs it. For a bundle
  // analysis, build locally with a map that the JS does not link to:
  //   npm run build -w web -- --sourcemap hidden
  build: { sourcemap: false, target: "es2022" },
  test: {
    environment: "jsdom",
    setupFiles: ["test/setup.ts"],
    include: ["test/**/*.test.{ts,tsx}"],
  },
});
