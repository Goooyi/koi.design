#!/usr/bin/env node

import { startKoiStdioServer } from "./stdio.js";

startKoiStdioServer().catch((error: unknown) => {
  console.error("Koi MCP server failed:", error);
  process.exitCode = 1;
});
