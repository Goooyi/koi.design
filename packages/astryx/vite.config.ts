import { fileURLToPath } from "node:url";

import stylexPlugin from "@stylexjs/rollup-plugin";
import { defineConfig } from "vite-plus";

const packageRoot = fileURLToPath(new URL(".", import.meta.url));

// The same StyleX compile serves `vp pack` (emits components.css) and `vp test`, where source modules
// that call `stylex.create` would otherwise throw at import time.
const stylex = () =>
  stylexPlugin({
    dev: false,
    fileName: "components.css",
    unstable_moduleResolution: { type: "commonJS", rootDir: packageRoot },
  });

export default defineConfig({
  pack: {
    dts: true,
    exports: {
      customExports(exports) {
        exports["./theme.css"] = "./src/theme/generated/koi.css";
        exports["./components.css"] = "./dist/components.css";
        return exports;
      },
    },
    // Koi-authored Astryx-compatible components are written in StyleX on Astryx's token groups
    // and compiled at pack time, matching how Astryx itself ships.
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
