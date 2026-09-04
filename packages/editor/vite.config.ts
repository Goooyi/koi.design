import { fileURLToPath } from "node:url";

import stylexPlugin from "@stylexjs/rollup-plugin";
import { defineConfig } from "vite-plus";

const packageRoot = fileURLToPath(new URL(".", import.meta.url));

// The same StyleX compile serves `vp pack` (emits style.css) and `vp test`, where source modules
// that call `stylex.create` would otherwise throw at import time.
const stylex = () =>
  stylexPlugin({
    dev: false,
    fileName: "style.css",
    unstable_moduleResolution: { type: "commonJS", rootDir: packageRoot },
  });

export default defineConfig({
  pack: {
    dts: true,
    exports: {
      customExports(exports) {
        exports["./style.css"] = "./dist/style.css";
        return exports;
      },
    },
    // Editor chrome is authored in StyleX and compiled at pack time, so consumers receive the
    // same prebuilt JS-plus-stylesheet shape that Astryx itself ships.
    plugins: [stylex()],
  },
  plugins: [stylex()],
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
