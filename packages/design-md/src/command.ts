import { parseArgs } from "node:util";

import { buildTheme, type BuildOptions } from "./build.js";
import { DesignMdError, formatDiagnostic } from "./diagnostics.js";

export interface CliIo {
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  stdout(line: string): void;
  stderr(line: string): void;
}

const HELP = `koi-design-md — bridge a DESIGN.md onto Astryx's token contract

Usage:
  koi-design-md build <DESIGN.md> --out <theme.ts> [--name <theme>] [--export <constName>] [--check]
  koi-design-md inspect <DESIGN.md> [--json]

build    Emit a TypeScript module calling Astryx's defineTheme. With --check, compare it with the
         file at --out and exit 1 when they differ, so the generated theme cannot drift.
inspect  Print the mapping coverage and diagnostics (or the full design profile with --json).
`;

function describeError(error: unknown): string[] {
  if (error instanceof DesignMdError) {
    return [error.message, ...error.diagnostics.map((d) => `  ${formatDiagnostic(d)}`)];
  }
  return [error instanceof Error ? error.message : String(error)];
}

export async function runDesignMdCli(argv: readonly string[], io: CliIo): Promise<number> {
  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs({
      args: [...argv],
      allowPositionals: true,
      options: {
        out: { type: "string" },
        name: { type: "string" },
        export: { type: "string" },
        check: { type: "boolean", default: false },
        json: { type: "boolean", default: false },
        help: { type: "boolean", short: "h", default: false },
      },
    });
  } catch (error) {
    for (const line of describeError(error)) io.stderr(line);
    io.stderr(HELP);
    return 2;
  }
  const [command, input] = parsed.positionals;
  const {
    out,
    name,
    export: exportName,
    check,
    json,
    help,
  } = parsed.values as unknown as {
    out?: string;
    name?: string;
    export?: string;
    check: boolean;
    json: boolean;
    help: boolean;
  };
  if (help || !command) {
    io.stdout(HELP);
    return help ? 0 : 2;
  }
  if (!input) {
    io.stderr(`${command}: a DESIGN.md path is required`);
    return 2;
  }

  let source: string;
  try {
    source = await io.readFile(input);
  } catch (error) {
    io.stderr(`cannot read ${input}: ${describeError(error).join(" ")}`);
    return 2;
  }

  const options: BuildOptions = { fileName: input, sourceLabel: input };
  if (name !== undefined) options.name = name;
  if (exportName !== undefined) options.exportName = exportName;

  let result: ReturnType<typeof buildTheme>;
  try {
    result = buildTheme(source, options);
  } catch (error) {
    for (const line of describeError(error)) io.stderr(line);
    return 1;
  }

  if (command === "inspect") {
    if (json) {
      io.stdout(
        JSON.stringify({ profile: result.profile, coverage: result.bridge.coverage }, null, 2),
      );
      return 0;
    }
    io.stdout(
      `${result.document.name} (DESIGN.md ${result.document.formatVersion} → ${result.bridge.profile.id}/${result.bridge.profile.version})`,
    );
    for (const [from, to] of Object.entries(result.bridge.coverage.mapped)) {
      io.stdout(`  ${from} → ${to}`);
    }
    for (const diagnostic of result.bridge.diagnostics)
      io.stdout(`  ${formatDiagnostic(diagnostic)}`);
    return 0;
  }

  if (command !== "build") {
    io.stderr(`unknown command "${command}"`);
    io.stderr(HELP);
    return 2;
  }
  if (!out) {
    io.stderr("build: --out <theme.ts> is required");
    return 2;
  }

  for (const diagnostic of result.bridge.diagnostics) {
    if (diagnostic.severity !== "info") io.stderr(formatDiagnostic(diagnostic));
  }

  if (check) {
    const current = (await io.exists(out)) ? await io.readFile(out) : null;
    if (current !== result.module) {
      io.stderr(
        `${out} is out of date with ${input}; run the build without --check to regenerate it`,
      );
      return 1;
    }
    io.stdout(`✓ ${out} matches ${input}`);
    return 0;
  }
  await io.writeFile(out, result.module);
  io.stdout(`✓ ${out}`);
  return 0;
}
