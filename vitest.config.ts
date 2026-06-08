import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tsConfigPaths from "vite-tsconfig-paths";

// Dedicated test config — intentionally omits the TanStack Start / Cloudflare
// plugins from vite.config.ts, which are SSR/build concerns that don't belong in
// the jsdom unit-test environment.
export default defineConfig({
  plugins: [react(), tsConfigPaths({ projects: ["./tsconfig.json"] })],
  resolve: {
    alias: {
      "@": `${process.cwd()}/src`,
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
  },
});
