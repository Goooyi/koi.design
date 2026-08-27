import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
    dts: true,
    exports: true,
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
