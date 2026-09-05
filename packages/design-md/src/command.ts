import { parseArgs } from "node:util";

import { buildTheme, type BuildOptions } from "./build.js";
import { DesignMdError, formatDiagnostic } from "./diagnostics.js";
import { emitProfileModule } from "./emit.js";

export interface CliIo {
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  stdout(line: string): void;
  stderr(line: string): void;
}

const HELP = `koi-design-md — bridge a DESIGN.md onto Astryx's token contract

Usage:
  koi-design-md build <DESIGN.md> --out <theme.ts> [--name <theme>] [--export <constName>]
                     [--profile-out <profile.ts|.json>] [--check]
  koi-design-md inspect <DESIGN.md> [--json]

build    Emit a TypeScript module calling Astryx's defineTheme, and with --profile-out the design
         profile record a Koi document carries (a typed module for .ts, JSON otherwise). With
         --check, compare with the files on disk and exit 1 when they differ, so nothing drifts.
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
        "profile-out": { type: "string" },
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
    "profile-out": profileOut,
    name,
    export: exportName,
    check,
    json,
    help,
  } = parsed.values as unknown as {
    out?: string;
    "profile-out"?: string;
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

  const outputs: Array<[path: string, content: string]> = [[out, result.module]];
  if (profileOut) {
    const content = profileOut.endsWith(".ts")
      ? emitProfileModule(result.profile, { sourceLabel: input })
      : `${JSON.stringify(result.profile, null, 2)}\n`;
    outputs.push([profileOut, content]);
  }

  if (check) {
    for (const [path, content] of outputs) {
      const current = (await io.exists(path)) ? await io.readFile(path) : null;
      if (current !== content) {
        io.stderr(
          `${path} is out of date with ${input}; run the build without --check to regenerate it`,
        );
        return 1;
      }
      io.stdout(`✓ ${path} matches ${input}`);
    }
    return 0;
  }
  for (const [path, content] of outputs) {
    await io.writeFile(path, content);
    io.stdout(`✓ ${path}`);
  }
  return 0;
}
