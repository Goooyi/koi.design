import { parse as parseYaml } from "yaml";

import { DesignMdError, type Diagnostic } from "./diagnostics.js";
import {
  DESIGN_MD_FORMAT_VERSION,
  frontMatterSchema,
  isTokenReference,
  type DesignMdFrontMatter,
} from "./schema.js";

export interface DesignMdSection {
  level: 2 | 3;
  heading: string;
  body: string;
}

export interface DesignMdDocument {
  /** The format version this bridge implements; see `declaredVersion` for what the file says. */
  formatVersion: typeof DESIGN_MD_FORMAT_VERSION;
  declaredVersion: string | null;
  name: string;
  description: string | null;
  /** The front matter as written; token references are left unresolved here. */
  frontMatter: DesignMdFrontMatter;
  sections: DesignMdSection[];
  diagnostics: Diagnostic[];
}

/** The section order the spec prescribes, with the aliases it allows. */
export const SECTION_ORDER = [
  "Overview",
  "Colors",
  "Typography",
  "Layout",
  "Elevation & Depth",
  "Shapes",
  "Components",
  "Do's and Don'ts",
] as const;

const SECTION_ALIASES: Record<string, (typeof SECTION_ORDER)[number]> = {
  "brand & style": "Overview",
  "layout & spacing": "Layout",
  elevation: "Elevation & Depth",
};

export function canonicalSectionName(heading: string): (typeof SECTION_ORDER)[number] | null {
  const key = heading
    .trim()
    .replace(/[’`]/g, "'")
    .toLowerCase();
  for (const name of SECTION_ORDER) {
    if (name.toLowerCase() === key) return name;
  }
  return SECTION_ALIASES[key] ?? null;
}

/** Look a `{path.to.token}` reference up in the front matter. Returns `undefined` when it misses. */
export function resolveReference(frontMatter: DesignMdFrontMatter, reference: string): unknown {
  if (!isTokenReference(reference)) return undefined;
  const path = reference.slice(1, -1).split(".");
  let cursor: unknown = frontMatter;
  for (const segment of path) {
    if (cursor === null || typeof cursor !== "object") return undefined;
    cursor = (cursor as Record<string, unknown>)[segment];
  }
  return cursor;
}

function splitFrontMatter(source: string): { yaml: string; body: string } {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  if (lines[0] !== "---") {
    throw new DesignMdError("DESIGN.md must begin with a `---` front-matter fence", [
      { severity: "error", code: "front-matter-missing", message: "no front matter" },
    ]);
  }
  const end = lines.indexOf("---", 1);
  if (end === -1) {
    throw new DesignMdError("DESIGN.md front matter is not closed with a `---` line", [
      { severity: "error", code: "front-matter-unclosed", message: "front matter never closes" },
    ]);
  }
  return { yaml: lines.slice(1, end).join("\n"), body: lines.slice(end + 1).join("\n") };
}

function collectReferences(value: unknown, path: string, into: Array<[string, string]>): void {
  if (isTokenReference(value)) {
    into.push([path, value]);
  } else if (Array.isArray(value)) {
    value.forEach((entry, index) => collectReferences(entry, `${path}[${index}]`, into));
  } else if (value !== null && typeof value === "object") {
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      collectReferences(entry, path ? `${path}.${key}` : key, into);
    }
  }
}

function parseSections(body: string, diagnostics: Diagnostic[]): DesignMdSection[] {
  const sections: DesignMdSection[] = [];
  let current: DesignMdSection | null = null;
  let inFence = false;
  const seen = new Set<string>();
  let lastOrder = -1;

  for (const line of body.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    const match = inFence ? null : /^(##|###) +(.+?)\s*$/.exec(line);
    if (!match) {
      if (current) current.body += `${line}\n`;
      continue;
    }
    const level = match[1] === "##" ? 2 : 3;
    const heading = match[2]!;
    if (level === 2) {
      const canonical = canonicalSectionName(heading);
      const key = (canonical ?? heading).toLowerCase();
      if (seen.has(key)) {
        throw new DesignMdError(`duplicate section heading "${heading}"`, [
          {
            severity: "error",
            code: "section-duplicate",
            message: `duplicate section "${heading}"`,
          },
        ]);
      }
      seen.add(key);
      if (canonical) {
        const order = SECTION_ORDER.indexOf(canonical);
        if (order < lastOrder) {
          diagnostics.push({
            severity: "warning",
            code: "section-order",
            message: `section "${heading}" is out of the order the spec prescribes`,
          });
        }
        lastOrder = Math.max(lastOrder, order);
      } else {
        diagnostics.push({
          severity: "info",
          code: "section-unknown",
          message: `section "${heading}" is not one the spec names; it is preserved`,
        });
      }
    }
    current = { level, heading, body: "" };
    sections.push(current);
  }
  for (const section of sections) section.body = section.body.trim();
  return sections;
}

export interface ParseOptions {
  /** Used in error messages only. */
  fileName?: string;
}

/**
 * Parse a DESIGN.md (format `alpha`) into its front matter and sections. Hard errors, such as a
 * missing front matter, a schema violation, or a duplicate section, throw `DesignMdError`; softer
 * findings are returned as diagnostics.
 */
export function parseDesignMd(source: string, options: ParseOptions = {}): DesignMdDocument {
  const label = options.fileName ?? "DESIGN.md";
  const { yaml, body } = splitFrontMatter(source);
  let data: unknown;
  try {
    data = parseYaml(yaml);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new DesignMdError(`${label}: front matter is not valid YAML: ${message}`, [
      { severity: "error", code: "front-matter-yaml", message },
    ]);
  }
  const parsed = frontMatterSchema.safeParse(data);
  if (!parsed.success) {
    const issues: Diagnostic[] = parsed.error.issues.map((issue) => ({
      severity: "error",
      code: "front-matter-schema",
      message: issue.message,
      path: issue.path.map(String).join("."),
    }));
    throw new DesignMdError(
      `${label}: front matter does not match the DESIGN.md ${DESIGN_MD_FORMAT_VERSION} schema`,
      issues,
    );
  }
  const frontMatter = parsed.data;
  const diagnostics: Diagnostic[] = [];

  if (frontMatter.version !== undefined && frontMatter.version !== DESIGN_MD_FORMAT_VERSION) {
    diagnostics.push({
      severity: "warning",
      code: "format-version",
      message: `declares format version "${frontMatter.version}"; this bridge implements "${DESIGN_MD_FORMAT_VERSION}"`,
      path: "version",
    });
  }

  const references: Array<[string, string]> = [];
  collectReferences(frontMatter, "", references);
  for (const [path, reference] of references) {
    if (resolveReference(frontMatter, reference) === undefined) {
      diagnostics.push({
        severity: "warning",
        code: "reference-unresolved",
        message: `reference ${reference} does not resolve`,
        path,
      });
    }
  }

  const sections = parseSections(body, diagnostics);

  return {
    formatVersion: DESIGN_MD_FORMAT_VERSION,
    declaredVersion: frontMatter.version ?? null,
    name: frontMatter.name,
    description: frontMatter.description ?? null,
    frontMatter,
    sections,
    diagnostics,
  };
}
