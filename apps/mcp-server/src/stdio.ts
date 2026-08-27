import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { createKoiLocalMcpServer, type KoiLocalMcpServerOptions } from "./server.js";

/** Includes JSON-RPC framing overhead around Koi's 1 MB portable payload boundary. */
export const MAX_KOI_STDIO_MESSAGE_BYTES = 4 * 1024 * 1024;

export async function startKoiStdioServer(
  options: KoiLocalMcpServerOptions = {},
): Promise<McpServer> {
  const server = createKoiLocalMcpServer(options);
  await server.connect(
    new StdioServerTransport(process.stdin, process.stdout, {
      maxBufferSize: MAX_KOI_STDIO_MESSAGE_BYTES,
    }),
  );
  return server;
}
