import { defineConfig } from "vite-plus";

export default defineConfig({
  build: {
    outDir: "dist",
    ssr: "src/main.ts",
    target: "node22",
  },
  ssr: {
    // A standalone Node artifact avoids depending on workspace-specific module linkers in images.
    noExternal: true,
  },
  test: {
    include: ["tests/**/*.test.ts"],
  },
  lint: {
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },
  fmt: {},
});
