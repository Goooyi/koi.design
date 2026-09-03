import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite-plus";

const appRoot = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(appRoot, "../..");
const packageManifest = JSON.parse(readFileSync(path.join(appRoot, "package.json"), "utf8")) as {
  version: string;
};

function resolveBuildId(): string {
  const supplied = process.env.CF_PAGES_COMMIT_SHA ?? process.env.GITHUB_SHA;
  if (supplied) return supplied;
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: repositoryRoot,
      encoding: "utf8",
    }).trim();
  } catch {
    return "unknown";
  }
}

export default defineConfig(({ mode }) => {
  const buildId = resolveBuildId();
  const deploymentMode = mode === "challenge" ? "challenge" : "self-hosted";
  if (deploymentMode === "challenge" && buildId === "unknown") {
    throw new Error("A challenge build requires CF_PAGES_COMMIT_SHA, GITHUB_SHA, or Git metadata");
  }
  const buildMetadata = {
    status: "ok",
    version: packageManifest.version,
    buildId,
    deploymentMode,
  };
  return {
    define: {
      __KOI_BUILD_ID__: JSON.stringify(buildId),
      __KOI_DEPLOYMENT_MODE__: JSON.stringify(deploymentMode),
      __KOI_VERSION__: JSON.stringify(packageManifest.version),
    },
    plugins: [
      react(),
      {
        name: "koi-build-metadata",
        generateBundle() {
          this.emitFile({
            type: "asset",
            fileName: "health.json",
            source: `${JSON.stringify(buildMetadata, null, 2)}\n`,
          });
        },
      },
    ],
    server: {
      host: "127.0.0.1",
      port: 4173,
      strictPort: true,
    },
    preview: {
      host: "127.0.0.1",
      port: 4173,
      strictPort: true,
    },
    test: {
      include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    },
  };
});
