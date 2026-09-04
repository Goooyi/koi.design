export type Severity = "error" | "warning" | "info";

export interface Diagnostic {
  severity: Severity;
  /** Stable machine-readable code, e.g. `reference-unresolved`. */
  code: string;
  message: string;
  /** Dotted path into the front matter when the diagnostic points at a token. */
  path?: string;
}

export class DesignMdError extends Error {
  readonly diagnostics: readonly Diagnostic[];

  constructor(message: string, diagnostics: readonly Diagnostic[]) {
    super(message);
    this.name = "DesignMdError";
    this.diagnostics = diagnostics;
  }
}

export function formatDiagnostic(diagnostic: Diagnostic): string {
  const where = diagnostic.path ? ` (${diagnostic.path})` : "";
  return `${diagnostic.severity}: ${diagnostic.message}${where} [${diagnostic.code}]`;
}
