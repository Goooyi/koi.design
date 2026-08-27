import { expect, test } from "@playwright/test";

test.describe("Koi browser editor", () => {
  test("renders a bounded, virtualized HTML-native starter canvas", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    page.on("pageerror", (error) => errors.push(error.message));

    await page.goto("/");
    await expect(page).toHaveTitle(/Koi/);
    await expect(page.getByRole("region", { name: /Explorations infinite canvas/ })).toBeVisible();
    await expect(page.getByText("Design together, without the lock-in.")).toBeVisible();
    await expect(page.locator('[data-element-id="frame-brief"]')).toBeVisible();
    await expect(page.locator('[data-element-id="frame-gpu"]')).toHaveCount(0);
    await expect(page.locator('[data-element-kind="component"]')).toHaveCount(5);

    const nodeCount = await page.locator("*").count();
    expect(nodeCount).toBeLessThan(5_000);
    expect(errors).toEqual([]);
  });

  test("commits direct manipulation once and restores it from IndexedDB", async ({ page }) => {
    await page.goto("/");
    const frame = page.locator('[data-element-id="frame-brief"]');
    const before = Number(
      await frame.evaluate((element) => parseFloat((element as HTMLElement).style.left)),
    );
    const box = await frame.boundingBox();
    expect(box).not.toBeNull();

    await page.mouse.move(box!.x + 8, box!.y + 8);
    await page.mouse.down();
    await page.mouse.move(box!.x + 108, box!.y + 48, { steps: 5 });
    await page.mouse.up();
    await expect
      .poll(async () =>
        Number(await frame.evaluate((element) => parseFloat((element as HTMLElement).style.left))),
      )
      .toBeGreaterThan(before + 100);

    const committed = Number(
      await frame.evaluate((element) => parseFloat((element as HTMLElement).style.left)),
    );
    await page.reload();
    await expect(page.locator('[data-element-id="frame-brief"]')).toBeVisible();
    await expect
      .poll(async () =>
        Number(
          await page
            .locator('[data-element-id="frame-brief"]')
            .evaluate((element) => parseFloat((element as HTMLElement).style.left)),
        ),
      )
      .toBeCloseTo(committed, 3);

    await page.getByRole("button", { name: /^Frame/ }).click();
    await expect(page.locator(".koi-frame-label", { hasText: "Frame 5" })).toBeVisible();
    await page.reload();
    await expect(page.locator(".koi-frame-label", { hasText: "Frame 5" })).toBeVisible();
  });

  test("refreshes virtualized Frames after a programmatic camera reset", async ({ page }) => {
    await page.goto("/");
    const canvas = page.getByRole("region", { name: /infinite canvas/ });
    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();
    await page.getByRole("button", { name: /^Hand/ }).click();

    for (let swipe = 0; swipe < 2; swipe += 1) {
      await page.mouse.move(box!.x + box!.width - 50, box!.y + box!.height / 2);
      await page.mouse.down();
      await page.mouse.move(box!.x + 50, box!.y + box!.height / 2, { steps: 6 });
      await page.mouse.up();
    }

    await expect(page.locator('[data-element-id="frame-gpu"]')).toBeVisible();
    await expect(page.locator('[data-element-id="frame-brief"]')).toHaveCount(0);
    await page.getByRole("button", { name: "Reset view" }).click();
    await expect(page.locator('[data-element-id="frame-brief"]')).toBeVisible();
    await expect(page.locator('[data-element-id="frame-gpu"]')).toHaveCount(0);
  });

  test("keeps canvas shortcuts focused after selecting an element", async ({ page }) => {
    await page.goto("/");
    const frame = page.locator('[data-element-id="frame-brief"]');
    await frame.click({ position: { x: 10, y: 10 } });

    await page.keyboard.press("Delete");
    await expect(frame).toHaveCount(0);
    await page.keyboard.press("ControlOrMeta+z");
    await expect(page.locator('[data-element-id="frame-brief"]')).toBeVisible();
  });

  test("publishes authority transitions only after their IndexedDB checkpoint", async ({
    page,
  }) => {
    await page.goto("/");
    const frame = page.locator('[data-element-id="frame-brief"]');
    await expect(frame).toBeVisible();

    await page.evaluate(() => {
      const descriptor = Object.getOwnPropertyDescriptor(IDBObjectStore.prototype, "put")!;
      Object.defineProperty(IDBObjectStore.prototype, "put", {
        ...descriptor,
        value() {
          throw new DOMException("Simulated IndexedDB checkpoint failure", "QuotaExceededError");
        },
      });
    });
    await page.getByLabel("Import Koi document").setInputFiles({
      name: "failed-transition.koi.json",
      mimeType: "application/vnd.koi.document+json",
      buffer: Buffer.from(
        JSON.stringify({
          schemaVersion: 1,
          id: "failed-import",
          workspaceId: "failed-workspace",
          name: "This must not become visible",
          revision: 0,
          historyId: "failed-history",
          pages: [{ schemaVersion: 1, id: "failed-page", name: "Failed", elements: [] }],
          assets: [],
          designProfile: { id: "koi.astryx", version: "0.5.0", tokens: {} },
        }),
      ),
    });

    await expect(page.locator(".koi-toast")).toContainText(
      "Simulated IndexedDB checkpoint failure",
    );
    await expect(frame).toBeVisible();
    await expect(page.locator(".koi-status")).toContainText("Local");

    await page.evaluate(() => {
      const original = Storage.prototype.getItem;
      Object.defineProperty(Storage.prototype, "getItem", {
        configurable: true,
        value(this: Storage, key: string) {
          if (this === sessionStorage) throw new DOMException("Storage denied", "SecurityError");
          return original.call(this, key);
        },
      });
    });
    await page.getByRole("button", { name: "Connect hosting" }).click();
    await expect(page.getByRole("heading", { name: "Connect to your workspace" })).toBeVisible();
  });

  test("previews a Frame drag coherently across DOM, SVG, and connector layers", async ({
    page,
  }) => {
    await page.goto("/");
    const canvas = page.getByRole("region", { name: /infinite canvas/ });
    const canvasBox = await canvas.boundingBox();
    expect(canvasBox).not.toBeNull();
    await page.getByRole("button", { name: /^Hand/ }).click();
    await page.mouse.move(canvasBox!.x + canvasBox!.width * 0.7, canvasBox!.y + 300);
    await page.mouse.down();
    await page.mouse.move(canvasBox!.x + canvasBox!.width * 0.25, canvasBox!.y + 300, {
      steps: 6,
    });
    await page.mouse.up();
    await page.getByRole("button", { name: /^Select/ }).click();

    const frame = page.locator('[data-element-id="frame-flow"]');
    const shape = page.locator('[data-element-id="flow-human"] rect');
    const connector = page.locator('[data-element-id="flow-connector"] path');
    const frameBefore = await frame.boundingBox();
    const shapeBefore = await shape.boundingBox();
    const connectorBefore = await connector.boundingBox();
    expect(frameBefore).not.toBeNull();
    expect(shapeBefore).not.toBeNull();
    expect(connectorBefore).not.toBeNull();

    await page.mouse.move(frameBefore!.x + 10, frameBefore!.y + 10);
    await page.mouse.down();
    await page.mouse.move(frameBefore!.x + 110, frameBefore!.y + 60, { steps: 5 });

    await expect
      .poll(async () => (await shape.boundingBox())?.x)
      .toBeGreaterThan(shapeBefore!.x + 90);
    await expect
      .poll(async () => (await connector.boundingBox())?.x)
      .toBeGreaterThan(connectorBefore!.x + 90);
    await page.mouse.up();
    await expect
      .poll(async () => (await frame.boundingBox())?.x)
      .toBeGreaterThan(frameBefore!.x + 90);
  });

  test("supports real pen and text-editing interactions plus portable export", async ({ page }) => {
    await page.goto("/");
    const canvas = page.getByRole("region", { name: /infinite canvas/ });
    const canvasBox = await canvas.boundingBox();
    expect(canvasBox).not.toBeNull();
    const svgElements = page.locator(".koi-svg-layer > g[data-element-id]");
    const pathsBefore = await svgElements.count();

    await page.getByRole("button", { name: /^Pen/ }).click();
    await page.mouse.move(canvasBox!.x + 420, canvasBox!.y + canvasBox!.height - 100);
    await page.mouse.down();
    await page.mouse.move(canvasBox!.x + 500, canvasBox!.y + canvasBox!.height - 140, { steps: 8 });
    await page.mouse.up();
    await expect(svgElements).toHaveCount(pathsBefore + 1);

    await page.getByRole("button", { name: /^Select/ }).click();
    const note = page.locator('[data-element-id="brief-note"] .koi-note-surface');
    await note.dblclick();
    const editor = page.getByRole("textbox", { name: "Edit note" });
    await editor.fill("A human edit the agent can inspect.");
    await editor.press("ControlOrMeta+Enter");
    await expect(editor).toHaveCount(0);
    await expect(note).toHaveText("A human edit the agent can inspect.");

    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export .koi.json" }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/\.koi\.json$/);
  });

  test("preserves a human text draft when an agent changes the same Element", async ({ page }) => {
    await page.addInitScript(() => {
      type BrowserTool = {
        name: string;
        execute: (
          input: Record<string, unknown>,
          options: { signal: AbortSignal },
        ) => Promise<unknown>;
      };
      const tools = new Map<string, BrowserTool>();
      Object.defineProperty(window, "__koiTestTools", { value: tools });
      Object.defineProperty(document, "modelContext", {
        configurable: true,
        value: {
          registerTool: async (tool: BrowserTool) => {
            tools.set(tool.name, tool);
          },
        },
      });
    });
    await page.goto("/");
    await expect(page.getByText(/WebMCP ready/)).toBeVisible();

    const note = page.locator('[data-element-id="brief-note"] .koi-note-surface');
    await note.dblclick();
    const editor = page.getByRole("textbox", { name: "Edit note" });
    await editor.fill("Human draft in progress");

    const agentResult = await page.evaluate(async () => {
      type BrowserTool = {
        execute: (
          input: Record<string, unknown>,
          options: { signal: AbortSignal },
        ) => Promise<unknown>;
      };
      const tools = (window as typeof window & { __koiTestTools: Map<string, BrowserTool> })
        .__koiTestTools;
      const options = { signal: new AbortController().signal };
      const inspected = (await tools
        .get("inspect_elements")!
        .execute({ elementIds: ["brief-note"] }, options)) as {
        elements: Array<{ version: number }>;
      };
      return tools.get("update_elements")!.execute(
        {
          commandId: "agent-concurrent-text-edit",
          updates: [
            {
              pageId: "page-explorations",
              elementId: "brief-note",
              expectedVersion: inspected.elements[0]!.version,
              changes: {
                properties: { content: "Agent edit committed", color: "#ffe694" },
              },
            },
          ],
        },
        options,
      );
    });
    expect(agentResult).toMatchObject({ ok: true });
    await expect(editor).toHaveValue("Human draft in progress");

    await editor.press("ControlOrMeta+Enter");
    await expect(editor).toBeVisible();
    await expect(page.locator(".koi-toast")).toContainText(/version|changed/i);
    await editor.press("Escape");
    await expect(editor).toHaveCount(0);
    await expect(note).toHaveText("Agent edit committed");

    const inspector = page.getByRole("complementary", { name: "Element inspector" });
    const contentField = inspector.locator("textarea");
    await contentField.fill("Inspector human draft");

    const secondAgentResult = await page.evaluate(async () => {
      type BrowserTool = {
        execute: (
          input: Record<string, unknown>,
          options: { signal: AbortSignal },
        ) => Promise<unknown>;
      };
      const tools = (window as typeof window & { __koiTestTools: Map<string, BrowserTool> })
        .__koiTestTools;
      const options = { signal: new AbortController().signal };
      const inspected = (await tools
        .get("inspect_elements")!
        .execute({ elementIds: ["brief-note"] }, options)) as {
        elements: Array<{ version: number }>;
      };
      return tools.get("update_elements")!.execute(
        {
          commandId: "agent-concurrent-inspector-edit",
          updates: [
            {
              pageId: "page-explorations",
              elementId: "brief-note",
              expectedVersion: inspected.elements[0]!.version,
              changes: {
                properties: { content: "Second agent edit committed", color: "#ffe694" },
              },
            },
          ],
        },
        options,
      );
    });
    expect(secondAgentResult).toMatchObject({ ok: true });
    await expect(contentField).toHaveValue("Inspector human draft");

    await page.getByRole("button", { name: "Reset view" }).click();
    await expect(contentField).toBeFocused();
    await expect(contentField).toHaveValue("Inspector human draft");
    await expect(page.locator(".koi-toast")).toContainText(/version|changed/i);
    await contentField.press("Escape");
    await expect(contentField).toHaveValue("Second agent edit committed");

    const frame = page.locator('[data-element-id="frame-brief"]');
    const body = page.locator('[data-element-id="brief-body"]');
    const bodyLeft = Number(
      await body.evaluate((element) => parseFloat((element as HTMLElement).style.left)),
    );
    await frame.click({ position: { x: 10, y: 10 } });
    await inspector.getByLabel("X", { exact: true }).fill("999");
    await body.click();
    await expect(body).toHaveClass(/is-selected/);
    await expect
      .poll(async () =>
        Number(await body.evaluate((element) => parseFloat((element as HTMLElement).style.left))),
      )
      .toBe(bodyLeft);
  });
});
