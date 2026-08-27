import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
    dts: true,
    exports: {
      customExports(exports) {
        exports["./style.css"] = "./dist/style.css";
        return exports;
      },
    },
  },
  test: {
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
  },
  lint: {
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },
  fmt: {},
});
