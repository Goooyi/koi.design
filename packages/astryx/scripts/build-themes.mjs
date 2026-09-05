#!/usr/bin/env node
// Builds Koi's themes: DESIGN.md → defineTheme module (via @koidesign/design-md) → CSS (via the
// Astryx CLI). With --check, both stages compare against the committed output and fail on drift.
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const check = process.argv.includes("--check");
// The bridge is a workspace sibling; run its CLI by path so a fresh checkout works before pnpm
// has linked bin shims for it.
const designMdCli = path.resolve(packageRoot, "../design-md/dist/cli.mjs");
const themes = [
  { name: "koi", source: "../../DESIGN.md" },
  { name: "apple", source: "../design-md/fixtures/apple/DESIGN.md", profile: true },
];

for (const theme of themes) {
  const module = `src/theme/generated/${theme.name}.theme.ts`;
  const css = `src/theme/generated/${theme.name}.css`;
  const profile = theme.profile
    ? ["--profile-out", `src/theme/generated/${theme.name}.profile.ts`]
    : [];
  run(process.execPath, [
    designMdCli,
    "build",
    theme.source,
    "--out",
    module,
    "--name",
    theme.name,
    ...profile,
    ...(check ? ["--check"] : []),
  ]);
  run("astryx", ["theme", "build", module, "--out", css, ...(check ? ["--check"] : [])]);
}

function run(bin, args) {
  execFileSync(bin, args, { cwd: packageRoot, stdio: "inherit" });
}
