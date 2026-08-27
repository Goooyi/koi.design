import react from "@vitejs/plugin-react";
import { defineConfig } from "vite-plus";
import { viteSingleFile } from "vite-plugin-singlefile";

export default defineConfig({
  plugins: [react(), viteSingleFile()],
  build: {
    emptyOutDir: true,
    minify: true,
    outDir: "dist",
    rollupOptions: {
      input: "mcp-app.html",
    },
    sourcemap: false,
    target: "es2022",
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
