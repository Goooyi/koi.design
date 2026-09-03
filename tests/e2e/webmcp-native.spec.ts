import { chromium, expect, test, type BrowserContext } from "@playwright/test";
import path from "node:path";

import { serveStaticDirectory } from "../../scripts/lib/serve-static-directory.mjs";

const STRICT_SCRIPT_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "connect-src 'self' ws: http://127.0.0.1:*",
  "font-src 'self' data:",
  "img-src 'self' data: blob:",
  "worker-src 'self' blob:",
].join("; ");

test("native WebMCP executes the complete tool contract without CSP errors", async () => {
  const staticServer = await serveStaticDirectory(path.join(process.cwd(), "apps/web/dist"), {
    responseHeaders: { "Content-Security-Policy": STRICT_SCRIPT_CSP },
  });
  let context: BrowserContext | undefined;
  try {
    context = await chromium.launchPersistentContext("", {
      viewport: { width: 1_440, height: 900 },
      args: [
        "--enable-experimental-web-platform-features",
        "--enable-features=WebMCPTesting",
        `--unsafely-treat-insecure-origin-as-secure=${staticServer.url}`,
      ],
    });
    const page = context.pages()[0] ?? (await context.newPage());
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    const contentSecurityPolicyIssues: string[] = [];
    const cdp = await context.newCDPSession(page);

    cdp.on("Audits.issueAdded", ({ issue }) => {
      if (issue.code === "ContentSecurityPolicyIssue") {
        contentSecurityPolicyIssues.push(issue.code);
      }
    });
    await cdp.send("Audits.enable");

    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    page.on("pageerror", (error) => pageErrors.push(error.message));

    await page.goto(staticServer.url, { waitUntil: "networkidle" });
    await expect(page.getByText("Local · WebMCP ready")).toBeVisible();
    await page.waitForFunction(async () => {
      const modelContext = (
        document as Document & {
          modelContext?: { getTools?: () => Promise<unknown[]> };
        }
      ).modelContext;
      return modelContext?.getTools && (await modelContext.getTools()).length === 8;
    });

    const smoke = await page.evaluate(async () => {
      type Tool = { name: string };
      type ModelContext = {
        getTools: () => Promise<Tool[]>;
        executeTool: (tool: Tool, input: string) => Promise<string>;
      };
      type ElementPreview = {
        id: string;
        version: number;
        name?: string | null;
        geometry: { x: number; y: number; width: number; height: number; rotation: number };
        properties: Record<string, unknown>;
      };
      const modelContext = (
        document as Document & { modelContext?: ModelContext }
      ).modelContext;
      if (!modelContext) throw new Error("Native WebMCP is unavailable.");
      const tools = await modelContext.getTools();
      const toolsByName = new Map(tools.map((tool) => [tool.name, tool]));
      const invoke = async (name: string, input: Record<string, unknown>) => {
        const tool = toolsByName.get(name);
        if (!tool) throw new Error(`Missing WebMCP tool ${name}.`);
        return JSON.parse(await modelContext.executeTool(tool, JSON.stringify(input))) as Record<
          string,
          any
        >;
      };
      const inspectedElement = (result: Record<string, any>, id: string): ElementPreview => {
        const element = (result.elements as ElementPreview[] | undefined)?.find(
          (candidate) => candidate.id === id,
        );
        if (!element) throw new Error(`Missing inspected Element ${id}.`);
        return element;
      };

      const elementId = "native-webmcp-smoke-note";
      const pageId = "page-explorations";
      const before = await invoke("get_canvas_context", {});
      const components = await invoke("list_components", {});
      const seed = await invoke("inspect_elements", {
        elementIds: ["frame-components", "component-button", "brief-note"],
      });
      const created = await invoke("create_elements", {
        commandId: "native-webmcp-smoke-create-v1",
        pageId,
        elements: [
          {
            schemaVersion: 1,
            id: elementId,
            name: "Native WebMCP smoke",
            kind: "note",
            parentId: "frame-components",
            geometry: { x: 40, y: 640, width: 240, height: 88, rotation: 0 },
            properties: {
              content: "Created by native Chrome contract smoke",
              color: "#d9f99d",
            },
          },
        ],
      });
      const afterCreate = await invoke("inspect_elements", { elementIds: [elementId] });
      const createdElement = inspectedElement(afterCreate, elementId);
      const updated = await invoke("update_elements", {
        commandId: "native-webmcp-smoke-update-v1",
        updates: [
          {
            pageId,
            elementId,
            expectedVersion: createdElement.version,
            changes: {
              name: "Native WebMCP smoke updated",
              properties: {
                content: "Updated by native Chrome contract smoke",
                color: "#bbf7d0",
              },
            },
          },
        ],
      });
      const afterUpdate = await invoke("inspect_elements", { elementIds: [elementId] });
      const updatedElement = inspectedElement(afterUpdate, elementId);
      const arranged = await invoke("arrange_elements", {
        commandId: "native-webmcp-smoke-arrange-v1",
        placements: [
          {
            pageId,
            elementId,
            expectedVersion: updatedElement.version,
            x: 56,
            y: 656,
            width: 240,
            height: 88,
          },
        ],
      });
      const afterArrange = await invoke("inspect_elements", { elementIds: [elementId] });
      const arrangedElement = inspectedElement(afterArrange, elementId);
      const exported = await invoke("export_document", {});
      const deleted = await invoke("delete_elements", {
        commandId: "native-webmcp-smoke-delete-v1",
        elements: [
          {
            pageId,
            elementId,
            expectedVersion: arrangedElement.version,
          },
        ],
      });
      const afterDelete = await invoke("inspect_elements", { elementIds: [elementId] });
      const after = await invoke("get_canvas_context", {});

      return {
        toolNames: tools.map((tool) => tool.name).sort(),
        before,
        components,
        seed,
        created,
        createdElement,
        updated,
        updatedElement,
        arranged,
        arrangedElement,
        exported: {
          ok: exported.ok,
          mediaType: exported.mediaType,
          bytes: exported.bytes,
          truncated: exported.truncated,
        },
        deleted,
        afterDelete,
        after,
      };
    });

    expect(smoke.toolNames).toEqual([
      "arrange_elements",
      "create_elements",
      "delete_elements",
      "export_document",
      "get_canvas_context",
      "inspect_elements",
      "list_components",
      "update_elements",
    ]);
    expect(smoke.before).toMatchObject({
      ok: true,
      page: { id: "page-explorations", elementCount: 22 },
      sync: { pending: 0 },
    });
    expect(smoke.components).toMatchObject({
      ok: true,
      profile: "koi.astryx/0.5.0",
    });
    expect(smoke.components.components).toHaveLength(5);
    expect(smoke.seed).toMatchObject({ ok: true, missingIds: [] });
    expect(smoke.created).toMatchObject({ ok: true, outcome: "applied" });
    expect(smoke.createdElement.version).toBe(1);
    expect(smoke.updated).toMatchObject({ ok: true, outcome: "applied" });
    expect(smoke.updatedElement).toMatchObject({
      version: 2,
      name: "Native WebMCP smoke updated",
      properties: { content: "Updated by native Chrome contract smoke", color: "#bbf7d0" },
    });
    expect(smoke.arranged).toMatchObject({ ok: true, outcome: "applied" });
    expect(smoke.arrangedElement).toMatchObject({
      version: 3,
      geometry: { x: 56, y: 656, width: 240, height: 88, rotation: 0 },
    });
    expect(smoke.exported).toMatchObject({
      ok: true,
      mediaType: "application/vnd.koi.document+json",
      truncated: false,
    });
    expect(smoke.exported.bytes).toBeGreaterThan(0);
    expect(smoke.deleted).toMatchObject({ ok: true, outcome: "applied" });
    expect(smoke.afterDelete).toMatchObject({
      ok: true,
      elements: [],
      missingIds: ["native-webmcp-smoke-note"],
    });
    expect(smoke.after.camera).toEqual(smoke.before.camera);
    expect(smoke.after.selection).toEqual(smoke.before.selection);
    expect(smoke.after.page.elementCount).toBe(smoke.before.page.elementCount);
    expect(smoke.after.sync.pending).toBe(0);

    await page.reload({ waitUntil: "networkidle" });
    await page.waitForFunction(async () => {
      const modelContext = (
        document as Document & {
          modelContext?: { getTools?: () => Promise<unknown[]> };
        }
      ).modelContext;
      return modelContext?.getTools && (await modelContext.getTools()).length === 8;
    });
    const afterReload = await page.evaluate(async () => {
      type Tool = { name: string };
      const modelContext = (
        document as Document & {
          modelContext: {
            getTools: () => Promise<Tool[]>;
            executeTool: (tool: Tool, input: string) => Promise<string>;
          };
        }
      ).modelContext;
      const tools = await modelContext.getTools();
      const inspect = tools.find((tool) => tool.name === "inspect_elements");
      if (!inspect) throw new Error("inspect_elements was not restored after reload.");
      return JSON.parse(
        await modelContext.executeTool(
          inspect,
          JSON.stringify({ elementIds: ["native-webmcp-smoke-note"] }),
        ),
      ) as Record<string, unknown>;
    });
    expect(afterReload).toMatchObject({
      ok: true,
      elements: [],
      missingIds: ["native-webmcp-smoke-note"],
    });
    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
    expect(contentSecurityPolicyIssues).toEqual([]);
  } finally {
    await context?.close();
    await staticServer.close();
  }
});
