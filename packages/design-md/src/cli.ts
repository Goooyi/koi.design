#!/usr/bin/env node

import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { runDesignMdCli } from "./command.js";

const code = await runDesignMdCli(process.argv.slice(2), {
  readFile: (path) => readFile(path, "utf8"),
  writeFile: async (path, content) => {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content, "utf8");
  },
  exists: (path) =>
    access(path).then(
      () => true,
      () => false,
    ),
  stdout: (line) => console.log(line),
  stderr: (line) => console.error(line),
});
process.exitCode = code;
