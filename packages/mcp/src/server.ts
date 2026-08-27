import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { registerKoiMcp, type RegisterKoiMcpOptions } from "./register.js";

export function createKoiMcpServer(options: RegisterKoiMcpOptions): McpServer {
  const server = new McpServer({ name: "koi-design", version: "0.1.0" });
  registerKoiMcp(server, options);
  return server;
}
