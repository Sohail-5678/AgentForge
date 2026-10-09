import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const root = fileURLToPath(new URL("./", import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      { find: /^@\/auth$/, replacement: `${root}tests/auth-stub.ts` },
      { find: /^@\//, replacement: root },
      { find: "server-only", replacement: `${root}tests/server-only-stub.ts` },
    ],
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
    include: ["**/*.test.{ts,tsx}"],
    exclude: ["node_modules/**", ".next/**"],
    css: false,
    // The Postgres integration tests share one throwaway database (TRUNCATE), so files run serially when it is set.
    fileParallelism: !process.env.TEST_DATABASE_URL,
  },
});
