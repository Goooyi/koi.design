import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it, vi } from "vite-plus/test";

import { KOI_MCP_APP_RESOURCE_URI, KOI_MCP_TOOL_NAMES } from "../src/protocol.js";
import { registerKoiMcp } from "../src/register.js";
import { InMemoryKoiDocumentRepository } from "../src/repository.js";

interface CapturedTool {
  config: Record<string, unknown>;
  handler: (...args: never[]) => unknown;
}

describe("MCP App registration", () => {
  it("links every semantic tool to the View and places the deny-by-default CSP on content", async () => {
    const tools = new Map<string, CapturedTool>();
    let resourceHandler: (() => Promise<Record<string, unknown>>) | undefined;
    const fakeServer = {
      registerTool: vi.fn(
        (name: string, config: Record<string, unknown>, handler: (...args: never[]) => unknown) => {
          tools.set(name, { config, handler });
          return {};
        },
      ),
      registerResource: vi.fn(
        (
          _name: string,
          uri: string,
          config: Record<string, unknown>,
          handler: () => Promise<Record<string, unknown>>,
        ) => {
          expect(uri).toBe(KOI_MCP_APP_RESOURCE_URI);
          expect(config).not.toHaveProperty("_meta.ui.csp");
          resourceHandler = handler;
          return {};
        },
      ),
    };

    registerKoiMcp(fakeServer as unknown as McpServer, {
      repository: new InMemoryKoiDocumentRepository(),
      loadViewHtml: async () => "<!doctype html><title>Koi</title>",
    });

    expect([...tools.keys()]).toEqual(Object.values(KOI_MCP_TOOL_NAMES));
    for (const [name, { config }] of tools) {
      expect(config).toMatchObject({
        _meta: {
          ui: {
            resourceUri: KOI_MCP_APP_RESOURCE_URI,
            visibility: name === KOI_MCP_TOOL_NAMES.readSnapshotChunk ? ["app"] : ["model", "app"],
          },
        },
      });
      expect(config).toHaveProperty("description");
    }

    expect(resourceHandler).toBeDefined();
    const resource = await resourceHandler?.();
    expect(resource).toMatchObject({
      contents: [
        {
          uri: KOI_MCP_APP_RESOURCE_URI,
          text: "<!doctype html><title>Koi</title>",
          _meta: {
            ui: {
              csp: {
                connectDomains: [],
                resourceDomains: [],
                frameDomains: [],
                baseUriDomains: [],
              },
              prefersBorder: false,
            },
          },
        },
      ],
    });
  });
});
