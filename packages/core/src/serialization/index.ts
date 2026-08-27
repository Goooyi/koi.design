import type { z } from "zod";

import {
  documentSchema,
  type Document,
  type Workspace,
  workspaceSchema,
} from "../document/schema.js";
import { exceedsUtf8ByteLimit } from "../encoding/utf8.js";

export const MAX_KOI_DOCUMENT_IMPORT_BYTES = 32 * 1024 * 1024;

export const KOI_DOCUMENT_MEDIA_TYPE = "application/vnd.koi.document+json" as const;

export type ImportIssue = Pick<z.core.$ZodIssue, "message" | "path">;

export type ImportResult<Value> = { ok: true; value: Value } | { ok: false; issues: ImportIssue[] };

export type DocumentImportResult =
  | { ok: true; document: Document }
  | { ok: false; issues: ImportIssue[] };

export type WorkspaceImportResult =
  | { ok: true; workspace: Workspace }
  | { ok: false; issues: ImportIssue[] };

function decode(source: unknown): ImportResult<unknown> {
  if (typeof source !== "string") {
    return { ok: true, value: source };
  }

  if (exceedsUtf8ByteLimit(source, MAX_KOI_DOCUMENT_IMPORT_BYTES)) {
    return {
      ok: false,
      issues: [
        {
          message: "Serialized Koi data exceeds the 32 MiB UTF-8 import limit",
          path: [],
        },
      ],
    };
  }

  try {
    return { ok: true, value: JSON.parse(source) as unknown };
  } catch (error) {
    return {
      ok: false,
      issues: [
        {
          message: error instanceof Error ? `Invalid JSON: ${error.message}` : "Invalid JSON",
          path: [],
        },
      ],
    };
  }
}

export function importDocument(source: unknown): DocumentImportResult {
  const decoded = decode(source);
  if (!decoded.ok) {
    return decoded;
  }

  const result = documentSchema.safeParse(decoded.value);
  return result.success
    ? { ok: true, document: result.data }
    : { ok: false, issues: result.error.issues };
}

export function exportDocument(document: unknown): string {
  return JSON.stringify(documentSchema.parse(document), null, 2);
}

export function importWorkspace(source: unknown): WorkspaceImportResult {
  const decoded = decode(source);
  if (!decoded.ok) {
    return decoded;
  }

  const result = workspaceSchema.safeParse(decoded.value);
  return result.success
    ? { ok: true, workspace: result.data }
    : { ok: false, issues: result.error.issues };
}

export function exportWorkspace(workspace: unknown): string {
  return JSON.stringify(workspaceSchema.parse(workspace), null, 2);
}
