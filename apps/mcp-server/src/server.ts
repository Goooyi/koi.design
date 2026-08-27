import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { createKoiMcpServer, type KoiDocumentRepository } from "@koi/mcp";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { FileKoiDocumentRepository, resolveKoiMcpDataFile } from "./file-repository.js";

export interface KoiLocalMcpServerOptions {
  repository?: KoiDocumentRepository;
  dataFilePath?: string;
  maxPendingMutations?: number;
  maxPendingReads?: number;
  loadViewHtml?: () => Promise<string>;
}

export async function loadBundledMcpViewHtml(): Promise<string> {
  const viewUrl = import.meta.resolve("@koi/mcp-view/mcp-app.html");
  return readFile(fileURLToPath(viewUrl), "utf8");
}

export function createKoiLocalMcpServer(options: KoiLocalMcpServerOptions = {}): McpServer {
  return createKoiMcpServer({
    repository:
      options.repository ??
      new FileKoiDocumentRepository({
        filePath: options.dataFilePath ?? resolveKoiMcpDataFile(),
        maxPendingMutations: options.maxPendingMutations,
        maxPendingReads: options.maxPendingReads,
      }),
    loadViewHtml: options.loadViewHtml ?? loadBundledMcpViewHtml,
  });
}
